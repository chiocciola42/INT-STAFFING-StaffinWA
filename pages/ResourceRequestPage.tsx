import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { z } from '../libs/zod';
// Fixed import: usePlanningContext does not exist, everything is in useEntitiesContext
import { useAppState } from '../context/AppContext';
import { useResourcesContext } from '../context/ResourcesContext';
import { useProjectsContext } from '../context/ProjectsContext';
import { useHRContext } from '../context/HRContext';
import { useAuth } from '../context/AuthContext';
import { ResourceRequest, ResourceRequestStatus } from '../types';
import { DataTable, ColumnDef } from '../components/DataTable';
import Modal from '../components/Modal';
import SearchableSelect from '../components/SearchableSelect';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import { SpinnerIcon } from '../components/icons';
import ConfirmationModal from '../components/ConfirmationModal';
import { formatDateFull } from '../utils/dateUtils';
import { useToast } from '../context/ToastContext';
import { FormFieldFeedback } from '../components/forms';
import ExportButton from '../components/ExportButton';
import PdfExportButton from '../components/PdfExportButton';
import { PdfExportConfig, CHART_PALETTE } from '../utils/pdfExportUtils';
import { useSearchParams } from 'react-router-dom';

// --- Types ---
type EnrichedRequest = ResourceRequest & {
    projectName: string;
    roleName: string;
    requestorName: string | null;
};

export const resourceRequestSchema = z.object({
    projectId: z.string().min(1, 'Seleziona un progetto.'),
    roleId: z.string().min(1, 'Seleziona un ruolo.'),
    requestorId: z.string().min(1, 'Seleziona un richiedente.').nullable().optional(),
    startDate: z.string().min(1, 'Inserisci la data di inizio.'),
    endDate: z.string().min(1, 'Inserisci la data di fine.'),
    commitmentPercentage: z.coerce.number().min(0, 'L\'impegno deve essere almeno 0%.').max(100, 'L\'impegno non può superare il 100%.'),
    isUrgent: z.boolean(),
    isLongTerm: z.boolean(),
    isTechRequest: z.boolean(),
    isOsrOpen: z.boolean(),
    osrNumber: z.string().trim().optional().nullable(),
    notes: z.string().optional().nullable(),
    status: z.enum(['ATTIVA', 'STANDBY', 'CHIUSA'] as [string, string, string], { required_error: 'Seleziona lo stato della richiesta.' }),
    version: z.number().optional()
}).refine(data => {
    if (!data.isOsrOpen) return true;
    return !!data.osrNumber && data.osrNumber.trim().length > 0;
}, {
    path: ['osrNumber'],
    message: 'Inserisci il numero OSR quando la richiesta è segnata come aperta.',
}).refine(data => {
    if (!data.startDate || !data.endDate) return true;
    return new Date(data.endDate) >= new Date(data.startDate);
}, {
    path: ['endDate'],
    message: 'La data di fine deve essere successiva o uguale alla data di inizio.',
});

const getStatusBadgeClass = (status: ResourceRequestStatus): string => {
    switch (status) {
        case 'ATTIVA': return 'bg-tertiary-container text-on-tertiary-container';
        case 'STANDBY': return 'bg-yellow-container text-on-yellow-container';
        case 'CHIUSA': return 'bg-surface-variant text-on-surface-variant';
        default: return 'bg-surface-variant text-on-surface-variant';
    }
};

const buildResourceRequestPayload = (
    request: ResourceRequest | Omit<ResourceRequest, 'id'>
): ResourceRequest | Omit<ResourceRequest, 'id'> => {
    const basePayload: any = {
        projectId: request.projectId,
        roleId: request.roleId,
        requestorId: request.requestorId ?? null,
        startDate: request.startDate,
        endDate: request.endDate,
        commitmentPercentage: request.commitmentPercentage,
        isUrgent: request.isUrgent,
        isLongTerm: request.isLongTerm,
        isTechRequest: request.isTechRequest,
        isOsrOpen: !!request.isOsrOpen,
        osrNumber: request.osrNumber ?? null,
        notes: request.notes ?? '',
        status: request.status,
    };

    // Preserve version for optimistic locking
    if (request.version !== undefined) {
        basePayload.version = request.version;
    }

    if ('id' in request) {
        return { id: request.id, ...basePayload };
    }

    return basePayload;
};

// Component for displaying best fit score bar
const ScoreBar: React.FC<{ score: number; colorClass: string; label: string }> = ({ score, colorClass, label }) => (
    <div className="flex items-center gap-3 text-xs w-full">
        <span className="w-24 text-on-surface-variant font-medium truncate" title={label}>{label}</span>
        <div className="flex-grow h-2.5 bg-surface-variant/30 rounded-full overflow-hidden">
            <div className={`h-full ${colorClass} transition-all duration-500 ease-out`} style={{ width: `${score}%` }}></div>
        </div>
        <span className="w-8 font-bold text-right">{score.toFixed(0)}</span>
    </div>
);

export const ResourceRequestPage: React.FC = () => {
    const { hasEntityVisibility } = useAuth();
    const {
        resourceRequests, addResourceRequest, updateResourceRequest, deleteResourceRequest, getBestFitResources,
    } = useHRContext();
    const { projects } = useProjectsContext();
    const { roles, resources } = useResourcesContext();
    const { isActionLoading, loading } = useAppState();
    const { addToast } = useToast();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRequest, setEditingRequest] = useState<ResourceRequest | Omit<ResourceRequest, 'id'> | null>(null);
    const [requestToDelete, setRequestToDelete] = useState<EnrichedRequest | null>(null);
    const [filters, setFilters] = useState({ projectId: [] as string[], roleId: [] as string[], status: [] as string[], requestorId: [] as string[] });
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [searchParams, setSearchParams] = useSearchParams();
    
    // AI Matching State
    const [isMatchingModalOpen, setIsMatchingModalOpen] = useState(false);
    const [matchingResults, setMatchingResults] = useState<any[]>([]);
    
    const emptyRequest: Omit<ResourceRequest, 'id'> = {
        projectId: '',
        roleId: '',
        requestorId: null,
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().split('T')[0],
        commitmentPercentage: 100,
        isUrgent: false,
        isLongTerm: false,
        isTechRequest: false,
        isOsrOpen: false,
        osrNumber: '',
        notes: '',
        status: 'ATTIVA',
    };

    // Deep Linking
    useEffect(() => {
        const editId = searchParams.get('editId');
        if (editId && !isModalOpen && resourceRequests.length > 0) {
            const target = resourceRequests.find(r => r.id === editId);
            if (target) {
                openModalForEdit(target);
                setSearchParams({});
            }
        }
    }, [searchParams, setSearchParams, resourceRequests, isModalOpen]);

    const dataForTable = useMemo<EnrichedRequest[]>(() => {
        return resourceRequests
            .filter(req => 
                (filters.projectId.length === 0 || filters.projectId.includes(req.projectId || '')) &&
                (filters.roleId.length === 0 || filters.roleId.includes(req.roleId || '')) &&
                (filters.status.length === 0 || filters.status.includes(req.status || '')) &&
                (filters.requestorId.length === 0 || filters.requestorId.includes(req.requestorId || ''))
            )
            .map(req => ({
                ...req,
                projectName: projects.find(p => p.id === req.projectId)?.name || 'N/A',
                roleName: roles.find(r => r.id === req.roleId)?.name || 'N/A',
                requestorName: resources.find(r => r.id === req.requestorId)?.name || null,
            }));
    }, [resourceRequests, projects, roles, resources, filters]);

    const exportData = useMemo(() => {
        return dataForTable.map(req => ({
            'Codice': req.requestCode || '',
            'Progetto': req.projectName,
            'Ruolo Richiesto': req.roleName,
            'Richiedente': req.requestorName || '-',
            'Stato': req.status,
            'Data Inizio': formatDateFull(req.startDate),
            'Data Fine': formatDateFull(req.endDate),
            'Impegno %': req.commitmentPercentage,
            'Urgente': req.isUrgent ? 'Sì' : 'No',
            'Tech': req.isTechRequest ? 'Sì' : 'No',
            'OSR Aperta': req.isOsrOpen ? 'Sì' : 'No',
            'Numero OSR': req.osrNumber || '',
            'Note': req.notes || ''
        }));
    }, [dataForTable]);

    const summaryData = useMemo(() => {
        const fteByRole: { [roleName: string]: number } = {};
        const requestsByProject: { [projectName: string]: { roleName: string; commitmentPercentage: number }[] } = {};

        const relevantRequests = dataForTable.filter(req => req.status !== 'STANDBY' && req.status !== 'CHIUSA');

        relevantRequests.forEach(req => {
            if (!fteByRole[req.roleName]) {
                fteByRole[req.roleName] = 0;
            }
            fteByRole[req.roleName] += req.commitmentPercentage / 100;

            if (!requestsByProject[req.projectName]) {
                requestsByProject[req.projectName] = [];
            }
            requestsByProject[req.projectName].push({
                roleName: req.roleName,
                commitmentPercentage: req.commitmentPercentage,
            });
        });

        const fteArray = Object.entries(fteByRole)
            .map(([roleName, fte]) => ({ roleName, fte }))
            .sort((a, b) => b.fte - a.fte);

        const projectArray = Object.entries(requestsByProject)
            .map(([projectName, requests]) => ({ projectName, requests }))
            .sort((a, b) => a.projectName.localeCompare(b.projectName));

        return { fteArray, projectArray };
    }, [dataForTable]);

    const handleFilterChange = (name: string, values: string[]) => {
        setFilters(prev => ({ ...prev, [name]: values }));
    };

    const resetFilters = () => {
        setFilters({ projectId: [], roleId: [], status: [], requestorId: [] });
    };

    const openModalForNew = () => {
        setEditingRequest(emptyRequest);
        setIsModalOpen(true);
    };

    const openModalForEdit = (request: ResourceRequest) => {
        const sanitizedRequest = buildResourceRequestPayload(request);
        const formattedRequest = {
            ...sanitizedRequest,
            startDate: sanitizedRequest.startDate ? sanitizedRequest.startDate.split('T')[0] : '',
            endDate: sanitizedRequest.endDate ? sanitizedRequest.endDate.split('T')[0] : '',
            isOsrOpen: !!sanitizedRequest.isOsrOpen,
            osrNumber: sanitizedRequest.osrNumber ?? '',
            requestorId: sanitizedRequest.requestorId ?? null,
        };
        setEditingRequest(formattedRequest);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingRequest(null);
        setFormErrors({});
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!editingRequest) return;

        const validationResult = resourceRequestSchema.safeParse(editingRequest);

        if (!validationResult.success) {
            const fieldErrors = (validationResult as any).error.flatten().fieldErrors;
            setFormErrors({
                projectId: fieldErrors.projectId?.[0] ?? '',
                roleId: fieldErrors.roleId?.[0] ?? '',
                requestorId: fieldErrors.requestorId?.[0] ?? '',
                startDate: fieldErrors.startDate?.[0] ?? '',
                endDate: fieldErrors.endDate?.[0] ?? '',
                commitmentPercentage: fieldErrors.commitmentPercentage?.[0] ?? '',
                osrNumber: fieldErrors.osrNumber?.[0] ?? '',
                status: fieldErrors.status?.[0] ?? '',
            });
            addToast('Correggi gli errori evidenziati prima di continuare.', 'error');
            return;
        }

        const validRequest = validationResult.data as ResourceRequest;
        const startDate = new Date(validRequest.startDate);
        const endDate = new Date(validRequest.endDate);
        const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const osrNumber = validRequest.isOsrOpen ? validRequest.osrNumber : null;

        const requestToSave = buildResourceRequestPayload({
            ...validRequest,
            id: 'id' in editingRequest ? editingRequest.id : undefined,
            isLongTerm: diffDays > 60,
            osrNumber,
        });

        setFormErrors({});

        try {
            if ('id' in editingRequest) {
                await updateResourceRequest(requestToSave as ResourceRequest);
                addToast('Richiesta aggiornata con successo.', 'success');
            } else {
                await addResourceRequest(requestToSave as Omit<ResourceRequest, 'id'>);
                addToast('Richiesta creata con successo.', 'success');
            }
            handleCloseModal();
        } catch (err) {
            // Il toast di errore è già mostrato dal contesto; il modale resta aperto.
            console.error(err);
        }
    };
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        if (!editingRequest) return;
        const { name, value, type } = e.target;

        if (type === 'checkbox') {
            const { checked } = e.target as HTMLInputElement;
            setEditingRequest({ ...editingRequest, [name]: checked });
        } else {
            setEditingRequest({ ...editingRequest, [name]: name === 'commitmentPercentage' ? Number(value) : value });
        }
        setFormErrors(prev => ({ ...prev, [name]: '' }));
    };

    const handleSelectChange = (name: string, value: string) => {
        if (editingRequest) {
            const normalizedValue = value === '' ? null : value;
            setEditingRequest({ ...editingRequest, [name]: normalizedValue as string | null });
            setFormErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const handleDelete = async () => {
        if (requestToDelete) {
            try {
                await deleteResourceRequest(requestToDelete.id!);
                addToast('Richiesta eliminata con successo.', 'success');
                setRequestToDelete(null);
            } catch (e) {
                addToast('Errore durante l\'eliminazione.', 'error');
            }
        }
    };

    // --- AI MATCHING HANDLERS ---
    const openMatchingModal = async (request: EnrichedRequest) => {
        if (request.status === 'CHIUSA') {
            addToast('Impossibile cercare candidati per una richiesta chiusa.', 'warning');
            return;
        }

        setMatchingResults([]); // Clear previous results
        setIsMatchingModalOpen(true);
        try {
            const results = await getBestFitResources({
                startDate: request.startDate,
                endDate: request.endDate,
                roleId: request.roleId,
                projectId: request.projectId,
                commitmentPercentage: request.commitmentPercentage // Pass required commitment
            });
            // Ensure results is an array to prevent crashes
            setMatchingResults(Array.isArray(results) ? results : []);
        } catch (e) {
            console.error(e);
            addToast('Errore durante la ricerca dei candidati.', 'error');
            setIsMatchingModalOpen(false);
        }
    };

    const projectOptions = useMemo(() => projects.map(p => ({ value: p.id!, label: p.name })), [projects]);
    const roleOptions = useMemo(() => roles.map(r => ({ value: r.id!, label: r.name })), [roles]);
    const resourceOptions = useMemo(() => resources.map(r => ({ value: r.id!, label: r.name })), [resources]);
    const statusOptions: { value: ResourceRequestStatus, label: string }[] = [
        { value: 'ATTIVA', label: 'Attiva' },
        { value: 'STANDBY', label: 'Standby' },
        { value: 'CHIUSA', label: 'Chiusa' },
    ];

    const columns: ColumnDef<EnrichedRequest>[] = [
        { header: 'ID Richiesta', sortKey: 'requestCode', cell: r => <span className="font-mono text-xs font-semibold">{r.requestCode}</span> },
        { header: 'Progetto', sortKey: 'projectName', cell: r => <span className="font-medium text-on-surface">{r.projectName}</span> },
        { header: 'Ruolo Richiesto', sortKey: 'roleName', cell: r => r.roleName },
        { header: 'Richiedente', sortKey: 'requestorName', cell: r => r.requestorName || 'N/A' },
        { header: 'Periodo', sortKey: 'startDate', cell: r => `${formatDateFull(r.startDate)} - ${formatDateFull(r.endDate)}` },
        { header: 'Impegno', sortKey: 'commitmentPercentage', cell: r => `${r.commitmentPercentage}%` },
        { header: 'Stato', sortKey: 'status', cell: r => <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(r.status)}`}>{r.status}</span> },
        { header: 'OSR', cell: r => r.isOsrOpen ? <span className="px-2 py-0.5 rounded text-xs font-semibold bg-primary-container text-on-primary-container" title={`OSR: ${r.osrNumber || 'N/D'}`}>OSR {r.osrNumber}</span> : '-' },
    ];

    const renderRow = (request: EnrichedRequest) => {
        const isClosed = request.status === 'CHIUSA';
        return (
            <tr key={request.id} className="group hover:bg-surface-container">
                {columns.map((col, i) => <td key={i} className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-variant bg-inherit">{col.cell(request)}</td>)}
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium bg-inherit">
                    <div className="flex items-center justify-end space-x-2">
                        <button 
                            type="button" 
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openMatchingModal(request); }} 
                            className={`p-2 rounded-full transition-colors ${isClosed ? 'text-on-surface-variant/30 cursor-not-allowed' : 'hover:bg-tertiary-container text-tertiary'}`}
                            title={isClosed ? "Richiesta Chiusa" : "Trova Candidati"}
                            disabled={isClosed}
                        >
                            <span className="material-symbols-outlined">smart_toy</span>
                        </button>
                        <button 
                            type="button" 
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openModalForEdit(request); }} 
                            className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors" 
                            title="Modifica"
                        >
                            <span className="material-symbols-outlined">edit</span>
                        </button>
                        <button 
                            type="button" 
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRequestToDelete(request); }} 
                            className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant hover:text-error transition-colors" 
                            title="Elimina"
                        >
                            {isActionLoading(`deleteResourceRequest-${request.id}`) ? <SpinnerIcon className="w-5 h-5"/> : <span className="material-symbols-outlined">delete</span>}
                        </button>
                    </div>
                </td>
            </tr>
        );
    };
    
    const renderCard = (request: EnrichedRequest) => {
        const isClosed = request.status === 'CHIUSA';
        return (
            <div key={request.id} className="p-5 rounded-2xl shadow-md bg-surface-container-low flex flex-col gap-4 relative">
                <div className="flex justify-between items-start">
                    <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">{request.requestCode}</span>
                            <span className={`px-2 py-0.5 inline-flex text-[10px] leading-5 font-bold rounded-full uppercase tracking-tighter ${getStatusBadgeClass(request.status)}`}>{request.status}</span>
                        </div>
                        <h3 className="font-bold text-lg text-on-surface truncate pr-8" title={request.projectName}>{request.projectName}</h3>
                        <p className="text-sm text-on-surface-variant font-medium">{request.roleName}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                        <button 
                            type="button" 
                            onClick={(e) => { e.stopPropagation(); openMatchingModal(request); }} 
                            className={`p-2 rounded-full ${isClosed ? 'text-on-surface-variant/30 cursor-not-allowed' : 'text-tertiary hover:bg-surface-container'}`}
                            title={isClosed ? "Richiesta Chiusa" : "Smart Match"}
                            disabled={isClosed}
                        >
                            <span className="material-symbols-outlined text-xl">smart_toy</span>
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); openModalForEdit(request); }} className="p-2 text-on-surface-variant hover:text-primary rounded-full hover:bg-surface-container transition-colors" title="Modifica"><span className="material-symbols-outlined text-xl">edit</span></button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setRequestToDelete(request); }} className="p-2 text-on-surface-variant hover:text-error rounded-full hover:bg-surface-container transition-colors" title="Elimina">
                             {isActionLoading(`deleteResourceRequest-${request.id}`) ? <SpinnerIcon className="w-5 h-5"/> : <span className="material-symbols-outlined text-xl">delete</span>}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 border-t border-outline-variant">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">Periodo</span>
                        <span className="text-xs font-semibold text-on-surface">{formatDateFull(request.startDate)} - {formatDateFull(request.endDate)}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">Impegno</span>
                        <span className="text-xs font-semibold text-on-surface">{request.commitmentPercentage}%</span>
                    </div>
                    <div className="col-span-2 flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">Richiedente</span>
                        <span className="text-xs font-semibold text-on-surface">{request.requestorName || 'Non specificato'}</span>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-auto pt-2">
                    {request.isUrgent && <span className="px-2 py-1 text-[10px] font-bold text-on-error-container bg-error-container rounded-full flex items-center gap-1 uppercase"><span className="material-symbols-outlined text-[12px]">priority_high</span>Urgente</span>}
                    {request.isTechRequest && <span className="px-2 py-1 text-[10px] font-bold text-on-secondary-container bg-secondary-container rounded-full flex items-center gap-1 uppercase"><span className="material-symbols-outlined text-[12px]">code</span>Tech</span>}
                    {request.isOsrOpen && <span className="px-2 py-1 text-[10px] font-bold text-on-primary-container bg-primary-container rounded-full flex items-center gap-1 uppercase"><span className="material-symbols-outlined text-[12px]">assignment</span>OSR {request.osrNumber || 'N/D'}</span>}
                </div>
            </div>
        );
    };

    const filtersNode = (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <MultiSelectDropdown name="projectId" selectedValues={filters.projectId} onChange={handleFilterChange} options={projectOptions} placeholder="Tutti i Progetti"/>
            <MultiSelectDropdown name="roleId" selectedValues={filters.roleId} onChange={handleFilterChange} options={roleOptions} placeholder="Tutti i Ruoli"/>
            <MultiSelectDropdown name="requestorId" selectedValues={filters.requestorId} onChange={handleFilterChange} options={resourceOptions} placeholder="Tutti i Richiedenti"/>
            <div className="flex gap-2 w-full">
                <div className="flex-grow">
                    <MultiSelectDropdown name="status" selectedValues={filters.status} onChange={handleFilterChange} options={statusOptions} placeholder="Tutti gli Stati"/>
                </div>
                <button aria-label="Azzera filtri" onClick={resetFilters} className="px-4 py-2 bg-secondary-container text-on-secondary-container rounded-full hover:opacity-90 font-bold transition-opacity"><span className="material-symbols-outlined text-base">refresh</span></button>
            </div>
        </div>
    );

    const buildPdfConfig = useCallback((): PdfExportConfig => {
      const statusCounts: Record<string, number> = {};
      const roleCounts: Record<string, number> = {};
      dataForTable.forEach(r => {
        statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
        roleCounts[r.roleName] = (roleCounts[r.roleName] || 0) + 1;
      });
      const urgentCount = dataForTable.filter(r => r.isUrgent).length;
      const normalCount = dataForTable.length - urgentCount;

      return {
        title: 'Richieste Risorse',
        subtitle: `Totale: ${dataForTable.length} richieste`,
        charts: [
          {
            title: 'Richieste per Stato',
            chartJs: {
              type: 'doughnut',
              data: {
                labels: Object.keys(statusCounts),
                datasets: [{ data: Object.values(statusCounts), backgroundColor: [CHART_PALETTE[2], CHART_PALETTE[4], CHART_PALETTE[6]] }],
              },
              options: { plugins: { legend: { position: 'bottom' } } },
            },
          },
          {
            title: 'Urgenti vs Normali',
            chartJs: {
              type: 'pie',
              data: {
                labels: ['Urgenti', 'Normali'],
                datasets: [{ data: [urgentCount, normalCount], backgroundColor: [CHART_PALETTE[3], CHART_PALETTE[0]] }],
              },
              options: { plugins: { legend: { position: 'bottom' } } },
            },
          },
        ],
        tables: [
          {
            title: 'Elenco Richieste',
            head: [['Progetto', 'Ruolo', 'Stato', 'Inizio', 'Fine', 'Impegno %', 'Urgente']],
            body: exportData.map(row => [
              String(row['Progetto'] ?? ''),
              String(row['Ruolo Richiesto'] ?? ''),
              String(row['Stato'] ?? ''),
              String(row['Data Inizio'] ?? ''),
              String(row['Data Fine'] ?? ''),
              String(row['Impegno %'] ?? ''),
              String(row['Urgente'] ?? ''),
            ]),
          },
        ],
      };
    }, [dataForTable, exportData]);

    if (!hasEntityVisibility('resource_requests')) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
                <span className="material-symbols-outlined text-5xl text-on-surface-variant">lock</span>
                <p className="text-on-surface-variant font-bold">Non hai i permessi per visualizzare le Richieste Risorsa.</p>
                <p className="text-xs text-on-surface-variant">Contatta un amministratore per richiedere l'accesso.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* KPI Summary Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-surface-container-low p-5 rounded-2xl shadow overflow-hidden relative">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                             <span className="material-symbols-outlined text-lg">engineering</span> FTE per Figura
                        </h3>
                    </div>
                    {summaryData.fteArray.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-thumb-outline-variant">
                            {summaryData.fteArray.map(({ roleName, fte }) => (
                                <div key={roleName} className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-container-high transition-colors group">
                                    <span className="text-sm font-medium text-on-surface">{roleName}</span>
                                    <span className="text-sm font-bold text-primary bg-primary/10 px-3 py-0.5 rounded-full">{fte.toFixed(2)} FTE</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant opacity-50 italic text-sm">Nessuna richiesta attiva</div>
                    )}
                </div>

                <div className="bg-surface-container-low p-5 rounded-2xl shadow overflow-hidden relative">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-bold text-tertiary uppercase tracking-wider flex items-center gap-2">
                             <span className="material-symbols-outlined text-lg">folder_shared</span> FTE per Progetto
                        </h3>
                    </div>
                    {summaryData.projectArray.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto space-y-4 pr-2 scrollbar-thin scrollbar-thumb-outline-variant">
                            {summaryData.projectArray.map(({ projectName, requests }) => (
                                <div key={projectName} className="space-y-1">
                                    <p className="text-xs font-bold text-on-surface-variant uppercase tracking-tighter mb-1">{projectName}</p>
                                    <div className="space-y-1 pl-2 border-l-2 border-outline-variant">
                                        {requests.map((req, index) => (
                                            <div key={`${projectName}-${req.roleName}-${index}`} className="flex items-center justify-between text-xs">
                                                <span className="text-on-surface">{req.roleName}</span>
                                                <span className="font-bold text-tertiary">{(req.commitmentPercentage / 100).toFixed(2)} FTE</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-on-surface-variant opacity-50 italic text-sm">Nessuna richiesta attiva</div>
                    )}
                </div>
            </div>

            <DataTable<EnrichedRequest>
                title="Richieste di Risorse"
                addNewButtonLabel="Nuova Richiesta"
                data={dataForTable}
                columns={columns}
                filtersNode={filtersNode}
                onAddNew={openModalForNew}
                renderRow={renderRow}
                renderMobileCard={renderCard}
                initialSortKey="startDate"
                isLoading={loading}
                tableLayout={{ dense: true, striped: true, headerSticky: true }}
                numActions={3}
                actionsWidth={160}
                headerActions={<><ExportButton data={exportData} title="Richieste Risorse" /><PdfExportButton buildConfig={buildPdfConfig} /></>}
            />

            {editingRequest && (
                <Modal isOpen={isModalOpen} onClose={handleCloseModal} title={'id' in editingRequest ? 'Modifica Richiesta' : 'Nuova Richiesta'}>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Sezione Progetto */}
                        <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                            <h4 className="text-sm font-bold text-primary mb-4 uppercase tracking-wider flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">work</span> Info Progetto
                            </h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-on-surface-variant mb-1">Progetto *</label>
                                    <SearchableSelect name="projectId" value={editingRequest.projectId} onChange={handleSelectChange} options={projectOptions} placeholder="Seleziona progetto" />
                                    {formErrors.projectId && <FormFieldFeedback error={formErrors.projectId} />}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-on-surface-variant mb-1">Ruolo Richiesto *</label>
                                    <SearchableSelect name="roleId" value={editingRequest.roleId} onChange={handleSelectChange} options={roleOptions} placeholder="Seleziona ruolo" />
                                    {formErrors.roleId && <FormFieldFeedback error={formErrors.roleId} />}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-on-surface-variant mb-1">Richiedente</label>
                                    <SearchableSelect name="requestorId" value={editingRequest.requestorId || ''} onChange={handleSelectChange} options={resourceOptions} placeholder="Seleziona richiedente" />
                                    {formErrors.requestorId && <FormFieldFeedback error={formErrors.requestorId} />}
                                </div>
                            </div>
                        </div>

                        {/* Sezione Periodo ed Impegno */}
                        <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                            <h4 className="text-sm font-bold text-primary mb-4 uppercase tracking-wider flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">calendar_month</span> Periodo & Impegno
                            </h4>
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-on-surface-variant mb-1">Data Inizio *</label>
                                        <input type="date" name="startDate" value={editingRequest.startDate} onChange={handleChange} required className="form-input" />
                                        {formErrors.startDate && <FormFieldFeedback error={formErrors.startDate} />}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-on-surface-variant mb-1">Data Fine *</label>
                                        <input type="date" name="endDate" value={editingRequest.endDate} onChange={handleChange} required className="form-input" />
                                        {formErrors.endDate && <FormFieldFeedback error={formErrors.endDate} />}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-on-surface-variant mb-1">Impegno (%) *</label>
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="range"
                                            name="commitmentPercentage"
                                            min="0"
                                            max="100"
                                            step="10"
                                            value={editingRequest.commitmentPercentage}
                                            onChange={handleChange}
                                            className="w-full accent-primary"
                                        />
                                        <span className="font-bold text-primary w-12 text-right">{editingRequest.commitmentPercentage}%</span>
                                    </div>
                                    {formErrors.commitmentPercentage && <FormFieldFeedback error={formErrors.commitmentPercentage} />}
                                </div>
                            </div>
                        </div>

                        {/* Sezione Dettagli e Stato */}
                        <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                             {/* Flags */}
                             <div className="flex flex-wrap gap-4 mb-4">
                                 <label className="flex items-center gap-2 cursor-pointer">
                                     <input type="checkbox" name="isUrgent" checked={editingRequest.isUrgent} onChange={handleChange} className="form-checkbox" />
                                     <span className="text-sm font-medium">Urgente</span>
                                 </label>
                                 <label className="flex items-center gap-2 cursor-pointer">
                                     <input type="checkbox" name="isTechRequest" checked={editingRequest.isTechRequest} onChange={handleChange} className="form-checkbox" />
                                     <span className="text-sm font-medium">Tech Request</span>
                                 </label>
                                 <label className="flex items-center gap-2 cursor-pointer">
                                     <input type="checkbox" name="isOsrOpen" checked={editingRequest.isOsrOpen} onChange={handleChange} className="form-checkbox" />
                                     <span className="text-sm font-medium">OSR Aperta</span>
                                 </label>
                             </div>

                             {editingRequest.isOsrOpen && (
                                 <div className="mb-4 animate-fade-in">
                                     <label className="block text-sm font-medium text-on-surface-variant mb-1">Numero OSR *</label>
                                     <input type="text" name="osrNumber" value={editingRequest.osrNumber || ''} onChange={handleChange} className="form-input" placeholder="Es. OSR-2024-001" />
                                     {formErrors.osrNumber && <FormFieldFeedback error={formErrors.osrNumber} />}
                                 </div>
                             )}

                             <div className="mb-4">
                                 <label className="block text-sm font-medium text-on-surface-variant mb-1">Note</label>
                                 <textarea name="notes" value={editingRequest.notes || ''} onChange={handleChange} className="form-textarea" rows={3} placeholder="Dettagli aggiuntivi..." />
                             </div>

                             <div>
                                 <label className="block text-sm font-medium text-on-surface-variant mb-1">Stato Richiesta</label>
                                 <select name="status" value={editingRequest.status} onChange={handleChange} className="form-select">
                                     <option value="ATTIVA">Attiva</option>
                                     <option value="STANDBY">Standby</option>
                                     <option value="CHIUSA">Chiusa</option>
                                 </select>
                                 {formErrors.status && <FormFieldFeedback error={formErrors.status} />}
                             </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant mt-4">
                             <button type="button" onClick={handleCloseModal} className="px-6 py-2 border border-outline rounded-full hover:bg-surface-container-low text-primary font-semibold transition-colors">Annulla</button>
                             <button type="submit" disabled={isActionLoading('addResourceRequest') || isActionLoading(`updateResourceRequest-${'id' in editingRequest ? editingRequest.id : ''}`)} className="flex justify-center items-center px-6 py-2 bg-primary text-on-primary rounded-full disabled:opacity-50 font-semibold hover:opacity-90 shadow-sm transition-all">
                                {(isActionLoading('addResourceRequest') || isActionLoading(`updateResourceRequest-${'id' in editingRequest ? editingRequest.id : ''}`)) ? <SpinnerIcon className="w-5 h-5"/> : 'Salva'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {isMatchingModalOpen && (
                <Modal isOpen={isMatchingModalOpen} onClose={() => setIsMatchingModalOpen(false)} title="Ricerca Candidati (AI Match)">
                    <div className="space-y-4">
                         <p className="text-sm text-on-surface-variant">I candidati sono ordinati in base alla disponibilità, competenze e costo.</p>
                         
                         {matchingResults.length === 0 ? (
                             <div className="text-center py-8 text-on-surface-variant italic">
                                 {isActionLoading('getBestFitResources') ? (
                                     <div className="flex flex-col items-center gap-2">
                                         <SpinnerIcon className="w-8 h-8 text-primary"/>
                                         <span>Analisi in corso...</span>
                                     </div>
                                 ) : (
                                     "Nessun candidato trovato con i criteri attuali."
                                 )}
                             </div>
                         ) : (
                             <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                                 {matchingResults.map((match: any) => (
                                     <div key={match.resource.id} className="p-3 bg-surface-container-low border border-outline-variant rounded-xl">
                                         <div className="flex justify-between items-center mb-2">
                                             <div className="font-bold text-on-surface">{match.resource.name}</div>
                                             <div className="text-xs font-bold bg-primary/10 text-primary px-2 py-1 rounded-full">Score: {match.score.toFixed(0)}</div>
                                         </div>
                                         <div className="space-y-1">
                                             <ScoreBar label="Disponibilità" score={match.details.availability} colorClass="bg-tertiary" />
                                             <ScoreBar label="Competenze" score={match.details.skillMatch} colorClass="bg-primary" />
                                             <ScoreBar label="Ruolo" score={match.details.roleMatch} colorClass="bg-secondary" />
                                         </div>
                                     </div>
                                 ))}
                             </div>
                         )}
                         <div className="flex justify-end pt-4 border-t border-outline-variant">
                             <button onClick={() => setIsMatchingModalOpen(false)} className="px-4 py-2 bg-surface text-primary font-bold rounded-full hover:bg-surface-container-high border border-outline">Chiudi</button>
                         </div>
                    </div>
                </Modal>
            )}

            {requestToDelete && (
                <ConfirmationModal
                    isOpen={!!requestToDelete}
                    onClose={() => setRequestToDelete(null)}
                    onConfirm={handleDelete}
                    title="Elimina Richiesta"
                    message={
                        <>
                            Sei sicuro di voler eliminare la richiesta <strong>{requestToDelete.requestCode}</strong>?<br/>
                            <span className="text-error text-sm">Questa azione è irreversibile.</span>
                        </>
                    }
                    isConfirming={isActionLoading(`deleteResourceRequest-${requestToDelete.id}`)}
                />
            )}
        </div>
    );
};

export default ResourceRequestPage;