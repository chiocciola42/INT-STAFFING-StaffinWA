
import type { VercelPool } from '@vercel/postgres';

export async function ensureDbTablesExist(db: VercelPool) {
    await db.sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

    // 1. Core Config
    await db.sql`
        CREATE TABLE IF NOT EXISTS app_config (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT NOT NULL
        );
    `;

    // 2. Base Dictionaries
    // MIGRATION: Rename horizontals to functions and add industries
    await db.sql`CREATE TABLE IF NOT EXISTS functions ( id UUID PRIMARY KEY, value VARCHAR(255) NOT NULL UNIQUE );`;
    await db.sql`CREATE TABLE IF NOT EXISTS industries ( id UUID PRIMARY KEY, value VARCHAR(255) NOT NULL UNIQUE );`;
    
    // Check if we need to migrate data from horizontals to functions if the table exists but the new one is empty
    try {
        await db.sql`INSERT INTO functions (id, value) SELECT id, value FROM horizontals ON CONFLICT DO NOTHING;`;
    } catch (e) { /* Table horizontals might not exist */ }

    await db.sql`CREATE TABLE IF NOT EXISTS seniority_levels ( id UUID PRIMARY KEY, value VARCHAR(255) NOT NULL UNIQUE );`;
    await db.sql`CREATE TABLE IF NOT EXISTS project_statuses ( id UUID PRIMARY KEY, value VARCHAR(255) NOT NULL UNIQUE );`;
    await db.sql`CREATE TABLE IF NOT EXISTS client_sectors ( id UUID PRIMARY KEY, value VARCHAR(255) NOT NULL UNIQUE );`;
    await db.sql`CREATE TABLE IF NOT EXISTS locations ( id UUID PRIMARY KEY, value VARCHAR(255) NOT NULL UNIQUE );`;
    await db.sql`CREATE TABLE IF NOT EXISTS company_calendar ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL, date DATE NOT NULL, type VARCHAR(50) NOT NULL, location VARCHAR(255), version INT DEFAULT 1, UNIQUE(date, location) );`;

    // 3. Skills Architecture
    await db.sql`CREATE TABLE IF NOT EXISTS skill_macro_categories ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE );`;
    await db.sql`CREATE TABLE IF NOT EXISTS skill_categories ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE );`;
    await db.sql`CREATE TABLE IF NOT EXISTS skill_category_macro_map ( category_id UUID REFERENCES skill_categories(id) ON DELETE CASCADE, macro_category_id UUID REFERENCES skill_macro_categories(id) ON DELETE CASCADE, PRIMARY KEY (category_id, macro_category_id) );`;
    await db.sql`CREATE TABLE IF NOT EXISTS skills ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, is_certification BOOLEAN DEFAULT FALSE, version INT DEFAULT 1 );`;
    await db.sql`CREATE TABLE IF NOT EXISTS skill_skill_category_map ( skill_id UUID REFERENCES skills(id) ON DELETE CASCADE, category_id UUID REFERENCES skill_categories(id) ON DELETE CASCADE, PRIMARY KEY (skill_id, category_id) );`;

    // 4. Operational Entities
    await db.sql`CREATE TABLE IF NOT EXISTS clients ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, sector VARCHAR(255), contact_email VARCHAR(255), version INT DEFAULT 1 );`;
    await db.sql`CREATE TABLE IF NOT EXISTS roles ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, seniority_level VARCHAR(255), daily_cost NUMERIC(10, 2), standard_cost NUMERIC(10, 2), daily_expenses NUMERIC(10, 2), overhead_pct NUMERIC(5, 2) DEFAULT 0, chargeable_pct NUMERIC(5, 2) DEFAULT 100, training_pct NUMERIC(5, 2) DEFAULT 0, bd_pct NUMERIC(5, 2) DEFAULT 0, version INT DEFAULT 1 );`;
    await db.sql`CREATE TABLE IF NOT EXISTS role_cost_history ( id UUID PRIMARY KEY, role_id UUID REFERENCES roles(id) ON DELETE CASCADE, daily_cost NUMERIC(10, 2) NOT NULL, start_date DATE NOT NULL, end_date DATE );`;
    
    // MIGRATION: Update resources table with function and industry
    await db.sql`CREATE TABLE IF NOT EXISTS resources ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE, role_id UUID REFERENCES roles(id), function VARCHAR(255), industry VARCHAR(255), location VARCHAR(255), hire_date DATE, work_seniority INT, notes TEXT, max_staffing_percentage INT DEFAULT 100, resigned BOOLEAN DEFAULT FALSE, last_day_of_work DATE, tutor_id UUID REFERENCES resources(id) ON DELETE SET NULL, daily_cost NUMERIC(10, 2) DEFAULT 0, is_talent BOOLEAN DEFAULT FALSE, seniority_code VARCHAR(50), version INT DEFAULT 1 );`;
    
    // Column Migrations for existing tables
    try {
        await db.sql`ALTER TABLE resources RENAME COLUMN horizontal TO function;`;
    } catch(e) { /* Column might already be renamed */ }
    await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS industry VARCHAR(255);`;
    await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS max_staffing_percentage INT DEFAULT 100;`;
    await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS resigned BOOLEAN DEFAULT FALSE;`;
    await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS last_day_of_work DATE;`;
    try {
        await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS tutor_id UUID REFERENCES resources(id) ON DELETE SET NULL;`;
    } catch(e) { /* Self-referencing FK may fail on some DB versions */ }
    await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS daily_cost NUMERIC(10, 2) DEFAULT 0;`;
    await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_talent BOOLEAN DEFAULT FALSE;`;
    await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS seniority_code VARCHAR(50);`;
    await db.sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;`;

    // 5. Skills Associations
    await db.sql`CREATE TABLE IF NOT EXISTS resource_skills ( resource_id UUID REFERENCES resources(id) ON DELETE CASCADE, skill_id UUID REFERENCES skills(id) ON DELETE CASCADE, level INT, acquisition_date DATE, expiration_date DATE, PRIMARY KEY (resource_id, skill_id) );`;

    // 6. Security & RBAC
    await db.sql`CREATE TABLE IF NOT EXISTS app_users ( id UUID PRIMARY KEY, username VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, role VARCHAR(50) NOT NULL DEFAULT 'SIMPLE', resource_id UUID REFERENCES resources(id) ON DELETE SET NULL, manager_ids JSONB NOT NULL DEFAULT '[]'::jsonb, is_active BOOLEAN DEFAULT TRUE, must_change_password BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, version INT DEFAULT 1 );`;
    try {
        // Migration: manager_id (single UUID) → manager_ids (JSONB array)
        await db.sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS manager_ids JSONB NOT NULL DEFAULT '[]'::jsonb;`;
        // Migrate old single manager_id to manager_ids array if column exists
        await db.sql`UPDATE app_users SET manager_ids = jsonb_build_array(manager_id) WHERE manager_id IS NOT NULL AND manager_ids = '[]'::jsonb;`;
        await db.sql`ALTER TABLE app_users DROP COLUMN IF EXISTS manager_id;`;
    } catch(e) { /* Migration may already be done */ }
    await db.sql`CREATE TABLE IF NOT EXISTS role_permissions ( role VARCHAR(50) NOT NULL, page_path VARCHAR(255) NOT NULL, is_allowed BOOLEAN DEFAULT FALSE, PRIMARY KEY (role, page_path) );`;
    await db.sql`CREATE TABLE IF NOT EXISTS role_entity_visibility ( role VARCHAR(50) NOT NULL, entity VARCHAR(100) NOT NULL, is_visible BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (role, entity) );`;
    // Seed iniziale: tutti i ruoli non-ADMIN vedono tutte le entità (backwards-compatible)
    await db.sql`
        INSERT INTO role_entity_visibility (role, entity, is_visible)
        SELECT r.role, e.entity, TRUE
        FROM (VALUES
            ('SIMPLE'), ('SIMPLE_EXT'), ('MANAGER'), ('MANAGER_EXT'),
            ('SENIOR MANAGER'), ('SENIOR MANAGER_EXT'),
            ('ASSOCIATE DIRECTOR'), ('ASSOCIATE DIRECTOR_EXT'),
            ('MANAGING DIRECTOR'), ('MANAGING DIRECTOR_EXT')
        ) AS r(role)
        CROSS JOIN (VALUES
            ('resources'), ('projects'), ('clients'), ('assignments'),
            ('allocations'), ('contracts'), ('rate_cards'), ('skills'),
            ('roles'), ('leaves'), ('resource_requests'), ('interviews'),
            ('wbs_tasks'), ('billing_milestones'), ('resource_evaluations')
        ) AS e(entity)
        ON CONFLICT (role, entity) DO NOTHING;
    `;
    await db.sql`CREATE TABLE IF NOT EXISTS action_logs ( id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), user_id UUID REFERENCES app_users(id) ON DELETE SET NULL, username VARCHAR(255), action VARCHAR(100) NOT NULL, entity VARCHAR(100), entity_id VARCHAR(255), details JSONB, ip_address VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );`;
    await db.sql`CREATE TABLE IF NOT EXISTS notifications ( id UUID PRIMARY KEY, recipient_resource_id UUID REFERENCES resources(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, message TEXT NOT NULL, link VARCHAR(255), is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP );`;
    await db.sql`CREATE TABLE IF NOT EXISTS notification_configs ( id UUID PRIMARY KEY, event_type VARCHAR(50) NOT NULL, webhook_url TEXT NOT NULL, description TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, version INT DEFAULT 1 );`;
    await db.sql`CREATE TABLE IF NOT EXISTS notification_rules ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL, event_type VARCHAR(50) NOT NULL, webhook_url TEXT NOT NULL, description TEXT, is_active BOOLEAN DEFAULT TRUE, template_blocks JSONB NOT NULL DEFAULT '[]', color VARCHAR(50) DEFAULT 'Default', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, version INT DEFAULT 1 );`;

    // 7. Projects & Planning
    await db.sql`CREATE TABLE IF NOT EXISTS rate_cards ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, currency VARCHAR(10) DEFAULT 'EUR', version INT DEFAULT 1 );`;
    try {
         await db.sql`CREATE TABLE IF NOT EXISTS rate_card_entries ( rate_card_id UUID REFERENCES rate_cards(id) ON DELETE CASCADE, resource_id UUID REFERENCES resources(id) ON DELETE CASCADE, daily_rate NUMERIC(10, 2) NOT NULL, PRIMARY KEY (rate_card_id, resource_id) );`;
    } catch(e) {
        // Ignorato intenzionalmente: la tabella potrebbe già esistere con vincoli diversi (migrazione)
        console.warn('[schema] rate_card_entries CREATE TABLE ignorato:', (e as Error).message);
    }

    await db.sql`CREATE TABLE IF NOT EXISTS contracts ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, start_date DATE, end_date DATE, cig VARCHAR(255) NOT NULL UNIQUE, cig_derivato VARCHAR(255), wbs VARCHAR(255), capienza NUMERIC(15, 2) NOT NULL, backlog NUMERIC(15, 2) DEFAULT 0, rate_card_id UUID REFERENCES rate_cards(id) ON DELETE SET NULL, billing_type VARCHAR(50) DEFAULT 'TIME_MATERIAL', version INT DEFAULT 1 );`;
    // Column migrations for contracts table (in case table existed before these columns were added)
    await db.sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS cig_derivato VARCHAR(255);`;
    await db.sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS wbs VARCHAR(255);`;
    await db.sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS backlog NUMERIC(15, 2) DEFAULT 0;`;
    await db.sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS billing_type VARCHAR(50) DEFAULT 'TIME_MATERIAL';`;
    await db.sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;`;
    try {
        await db.sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS rate_card_id UUID REFERENCES rate_cards(id) ON DELETE SET NULL;`;
    } catch(e) { /* FK constraint may fail if rate_cards doesn't exist yet */ }
    await db.sql`CREATE TABLE IF NOT EXISTS projects ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL, client_id UUID REFERENCES clients(id), start_date DATE, end_date DATE, budget NUMERIC(12, 2), realization_percentage INT DEFAULT 100, project_manager VARCHAR(255), status VARCHAR(100), notes TEXT, contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL, billing_type VARCHAR(50) DEFAULT 'TIME_MATERIAL', version INT DEFAULT 1, UNIQUE(name, client_id) );`;
    // Column migrations for projects table (in case table existed before these columns were added)
    await db.sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;`;
    await db.sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_type VARCHAR(50) DEFAULT 'TIME_MATERIAL';`;
    try {
        await db.sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL;`;
    } catch(e) { /* FK constraint may fail if contracts doesn't exist yet */ }
    await db.sql`CREATE TABLE IF NOT EXISTS assignments ( id UUID PRIMARY KEY, resource_id UUID REFERENCES resources(id) ON DELETE CASCADE, project_id UUID REFERENCES projects(id) ON DELETE CASCADE, UNIQUE(resource_id, project_id) );`;
    await db.sql`CREATE TABLE IF NOT EXISTS allocations ( assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE, allocation_date DATE, percentage INT, PRIMARY KEY(assignment_id, allocation_date) );`;
    await db.sql`CREATE TABLE IF NOT EXISTS contract_projects ( contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE, project_id UUID REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY (contract_id, project_id) );`;
    await db.sql`CREATE TABLE IF NOT EXISTS contract_managers ( contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE, resource_id UUID REFERENCES resources(id) ON DELETE CASCADE, PRIMARY KEY (contract_id, resource_id) );`;
    await db.sql`CREATE TABLE IF NOT EXISTS project_skills ( project_id UUID REFERENCES projects(id) ON DELETE CASCADE, skill_id UUID REFERENCES skills(id) ON DELETE CASCADE, PRIMARY KEY (project_id, skill_id) );`;
    await db.sql`CREATE TABLE IF NOT EXISTS project_expenses ( id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id) ON DELETE CASCADE, category VARCHAR(255) NOT NULL, description TEXT, amount NUMERIC(12, 2) NOT NULL, date DATE NOT NULL, billable BOOLEAN DEFAULT FALSE, version INT DEFAULT 1 );`;
    await db.sql`CREATE TABLE IF NOT EXISTS billing_milestones ( id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, date DATE NOT NULL, amount NUMERIC(12, 2) NOT NULL, status VARCHAR(50) NOT NULL DEFAULT 'PLANNED', version INT DEFAULT 1 );`;

    // 8. Recruitment & Operations
    await db.sql`CREATE TABLE IF NOT EXISTS resource_requests ( id UUID PRIMARY KEY, request_code VARCHAR(50), project_id UUID REFERENCES projects(id) ON DELETE CASCADE, role_id UUID REFERENCES roles(id) ON DELETE CASCADE, requestor_id UUID REFERENCES resources(id) ON DELETE SET NULL, start_date DATE NOT NULL, end_date DATE NOT NULL, commitment_percentage INT NOT NULL, is_urgent BOOLEAN DEFAULT FALSE, is_long_term BOOLEAN DEFAULT FALSE, is_tech_request BOOLEAN DEFAULT FALSE, is_osr_open BOOLEAN DEFAULT FALSE, osr_number VARCHAR(50), notes TEXT, status VARCHAR(50) NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, version INT DEFAULT 1 );`;
    // MIGRATION: allinea DB esistenti creati con versioni precedenti della tabella
    await db.sql`ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS request_code VARCHAR(50);`;
    await db.sql`ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS requestor_id UUID REFERENCES resources(id) ON DELETE SET NULL;`;
    await db.sql`ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN DEFAULT FALSE;`;
    await db.sql`ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS is_long_term BOOLEAN DEFAULT FALSE;`;
    await db.sql`ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS is_tech_request BOOLEAN DEFAULT FALSE;`;
    await db.sql`ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS is_osr_open BOOLEAN DEFAULT FALSE;`;
    await db.sql`ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS osr_number VARCHAR(50);`;
    await db.sql`ALTER TABLE resource_requests ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;`;
    // MIGRATION: horizontal -> function
    await db.sql`CREATE TABLE IF NOT EXISTS interviews ( id UUID PRIMARY KEY, resource_request_id UUID REFERENCES resource_requests(id) ON DELETE SET NULL, candidate_name VARCHAR(255) NOT NULL, candidate_surname VARCHAR(255) NOT NULL, birth_date DATE, function VARCHAR(255), role_id UUID REFERENCES roles(id) ON DELETE SET NULL, cv_summary TEXT, interviewers_ids UUID[], interview_date DATE, feedback VARCHAR(50), notes TEXT, hiring_status VARCHAR(50), entry_date DATE, status VARCHAR(50) NOT NULL, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, version INT DEFAULT 1 );`;
    try {
        await db.sql`ALTER TABLE interviews RENAME COLUMN horizontal TO function;`;
    } catch(e) { /* Column might already be renamed */ }

    // 9. Leave Management
    await db.sql`CREATE TABLE IF NOT EXISTS leave_types ( id UUID PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE, color VARCHAR(50) NOT NULL, requires_approval BOOLEAN DEFAULT TRUE, affects_capacity BOOLEAN DEFAULT TRUE, version INT DEFAULT 1 );`;
    await db.sql`CREATE TABLE IF NOT EXISTS leave_requests ( id UUID PRIMARY KEY, resource_id UUID REFERENCES resources(id) ON DELETE CASCADE, type_id UUID REFERENCES leave_types(id) ON DELETE RESTRICT, start_date DATE NOT NULL, end_date DATE NOT NULL, status VARCHAR(50) NOT NULL DEFAULT 'PENDING', manager_id UUID REFERENCES resources(id) ON DELETE SET NULL, notes TEXT, approver_ids UUID[], is_half_day BOOLEAN DEFAULT FALSE, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, version INT DEFAULT 1 );`;
    
    // 10. Performance Evaluation
    await db.sql`CREATE TABLE IF NOT EXISTS resource_evaluations ( id UUID PRIMARY KEY, resource_id UUID REFERENCES resources(id) ON DELETE CASCADE, fiscal_year INT NOT NULL, evaluator_id UUID REFERENCES resources(id) ON DELETE SET NULL, status VARCHAR(50) DEFAULT 'DRAFT', overall_rating INT, summary TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, version INT DEFAULT 1, UNIQUE(resource_id, fiscal_year, evaluator_id) );`;
    await db.sql`CREATE TABLE IF NOT EXISTS evaluation_metrics ( id UUID PRIMARY KEY, evaluation_id UUID REFERENCES resource_evaluations(id) ON DELETE CASCADE, category VARCHAR(100) NOT NULL, metric_key VARCHAR(100) NOT NULL, metric_value TEXT, score INT );`;

    // 11. Analytics Cache
    await db.sql`
        CREATE TABLE IF NOT EXISTS analytics_cache (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            key VARCHAR(255) UNIQUE NOT NULL,
            data JSONB,
            scope VARCHAR(50),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    // 12. Knowledge Base
    await db.sql`
        CREATE TABLE IF NOT EXISTS knowledge_base_articles (
            id UUID PRIMARY KEY,
            title VARCHAR(500) NOT NULL,
            content TEXT,
            format VARCHAR(20) NOT NULL DEFAULT 'html',
            tags JSONB NOT NULL DEFAULT '[]'::jsonb,
            linked_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            version INT DEFAULT 1
        );
    `;
}