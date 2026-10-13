import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppState } from '../context/AppContext';
import { useResourcesContext } from '../context/ResourcesContext';
import { useProjectsContext } from '../context/ProjectsContext';
import { useHRContext } from '../context/HRContext';
import { useAuth } from '../context/AuthContext';
import { useLookupContext } from '../context/LookupContext';
import { Interview, InterviewFeedback, InterviewHiringStatus, InterviewStatus, Resource } from '../types';
import Modal from '../components/Modal';
import SearchableSelect from '../components/SearchableSelect';
import { SpinnerIcon } from '../components/icons';
import ConfirmationModal from '../components/ConfirmationModal';
import MultiSelectDropdown from '../components/MultiSelectDropdown';
import { useToast } from '../context/ToastContext';
import { DataTable, ColumnDef } from '../components/DataTable';
import { formatDateFull } from '../utils/dateUtils';
import ExportButton from '../components/ExportButton';
import PdfExportButton from '../components/PdfExportButton';
import { PdfExportConfig, CHART_PALETTE } from '../utils/pdfExportUtils';
import { useSearchParams, useNavigate } from 'react-router-dom';

// --- Types ---
type EnrichedInterview = Interview & {
  resourceRequestLabel: string | null;
  roleName: string | null;
  interviewersNames: string[];
  age: string;
  averageRating: number;
};

// --- Helper Functions ---
const calculateAge = (birthDate: string | null): string => {
  if (!birthDate) return 'N/A';
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age.toString();
};

const toISODate = (s?: string | null) => (!s ? '' : new Date(s.split('T')[0]).toISOString().split('T')[0]);

const buildInterviewPayload = (interview: Interview | Omit<Interview, 'id'>): Interview | Omit<Interview, 'id'> => {
  const basePayload: any = {
    resourceRequestId: interview.resourceRequestId || null,
    candidateName: interview.candidateName,
    candidateSurname: interview.candidateSurname,
    birthDate: interview.birthDate || null,
    function: interview.function || null,
    roleId: interview.roleId || null,
    cvSummary: interview.cvSummary || null,
    interviewersIds: interview.interviewersIds && interview.interviewersIds.length > 0 ? interview.interviewersIds : null,
    interviewDate: interview.interviewDate || null,
    feedback: interview.feedback || null,
    notes: interview.notes || null,
    hiringStatus: interview.hiringStatus || null,
    entryDate: interview.entryDate || null,
    status: interview.status,
    
    ratingTechnicalMastery: interview.ratingTechnicalMastery || null,
    ratingProblemSolving: interview.ratingProblemSolving || null,
    ratingMethodQuality: interview.ratingMethodQuality || null,
    ratingDomainKnowledge: interview.ratingDomainKnowledge || null,
    ratingAutonomy: interview.ratingAutonomy || null,
    ratingCommunication: interview.ratingCommunication || null,
    ratingProactivity: interview.ratingProactivity || null,
    ratingTeamFit: interview.ratingTeamFit || null,
  };

  if (interview.version !== undefined) {
    basePayload.version = interview.version;
  }

  if ('id' in interview) {
    return { id: interview.id, ...basePayload };
  }

  return basePayload;
};

const RatingStarsDisplay: React.FC<{ value: number }> = ({ value }) => (
    <div className="flex items-center text-on-surface">
        {[1, 2, 3, 4, 5].map(s => (
            <span key={s} className="material-symbols-outlined text-base" style={{ fontVariationSettings: s <= Math.round(value) ? "'FILL' 1" : "'FILL' 0" }}>
                star
            </span>
        ))}
    </div>
);

const InterviewsPage: React.FC = () => {
    const { hasEntityVisibility } = useAuth();
    const { interviews, resourceRequests, addInterview, updateInterview, deleteInterview, updateResourceRequest } = useHRContext();
    const { roles, resources } = useResourcesContext();
    const { projects } = useProjectsContext();
    const { functions } = useLookupContext();
    const { loading, isActionLoading } = useAppState();
    
    const { addToast } = useToast();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // UI State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInterview, setEditingInterview] = useState<Interview | Omit<Interview, 'id'> | null>(null);
    const [interviewToDelete, setInterviewToDelete] = useState<EnrichedInterview | null>(null);
    const [filters, setFilters] = useState({ name: '', roleId: [] as string[], status: [] as string[], feedback: [] as string[] });

    // Deep Linking
    useEffect(() => {
        const editId = searchParams.get('editId');
        if (editId && !isModalOpen && interviews.length > 0) {
            const target = interviews.find(i => i.id === editId);
            if (target) {
                openModalForEdit(target);
                setSearchParams({});
            }
        }
    }, [searchParams, setSearchParams, interviews, isModalOpen]);

    const dataForTable = useMemo<EnrichedInterview[]>(() => {
        return interviews
            .filter(i => 
                (`${i.candidateName} ${i.candidateSurname}`).toLowerCase().includes(filters.name.toLowerCase()) &&
                (filters.roleId.length === 0 || filters.roleId.includes(i.roleId || '')) &&
                (filters.status.length === 0 || filters.status.includes(i.status || '')) &&
                (filters.feedback.length === 0 || filters.feedback.includes(i.feedback || ''))
            )
            .map(i => {
                const req = resourceRequests.find(r => r.id === i.resourceRequestId);
                const role = roles.find(r => r.id === i.roleId);
                const interviewers = i.interviewersIds ? resources.filter(r => i.interviewersIds?.includes(r.id!)).map(r => r.name) : [];
                
                const ratings = [
                    i.ratingTechnicalMastery, i.ratingProblemSolving, i.ratingMethodQuality,
                    i.ratingDomainKnowledge, i.ratingAutonomy, i.ratingCommunication,
                    i.ratingProactivity, i.ratingTeamFit
                ].filter(r => r !== null && r !== undefined && r > 0) as number[];
                
                const averageRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

                return {
                    ...i,
                    resourceRequestLabel: req ? `${req.requestCode}` : null,
                    roleName: role?.name || 'N/A',
                    interviewersNames: interviewers,
                    age: calculateAge(i.birthDate),
                    averageRating
                };
            });
    }, [interviews, resourceRequests, roles, resources, filters]);

    const kpis = useMemo(() => {
        const active = interviews.filter(i => i.status === 'Aperto').length;
        const positive = interviews.filter(i => i.feedback?.includes('Positivo')).length;
        const hired = interviews.filter(i => i.hiringStatus === 'SI' || i.hiringStatus === 'In Fase di Offerta').length;
        const standby = interviews.filter(i => i.status === 'StandBy').length;
        
        // Next incoming logic
        const incoming = interviews
            .filter(i => i.hiringStatus === 'SI' && i.entryDate)
            .sort((a,b) => new Date(a.entryDate!).getTime() - new Date(b.entryDate!).getTime())[0];

        return { active, positive, hired, standby, incoming };
    }, [interviews]);

    const exportData = useMemo(() => {
        return dataForTable.map(i => ({
            'Candidato': `${i.candidateName} ${i.candidateSurname}`,
            'Ruolo Proposto': i.roleName,
            'Function': i.function || '-',
            'Stato Processo': i.status,
            'Esito Colloquio': i.feedback || '-',
            'Data Colloquio': formatDateFull(i.interviewDate),
            'Valutazione': i.averageRating.toFixed(1)
        }));
    }, [dataForTable]);

    const openModalForNew = () => {
        setEditingInterview({
            candidateName: '', candidateSurname: '', birthDate: null, function: functions[0]?.value || '', 
            roleId: '', cvSummary: '', interviewersIds: [], interviewDate: new Date().toISOString().split('T')[0],
            feedback: null, notes: '', hiringStatus: null, entryDate: null, status: 'Aperto',
            resourceRequestId: null
        });
        setIsModalOpen(true);
    };

    const openModalForEdit = (interview: Interview) => {
        setEditingInterview({
            ...interview,
            birthDate: toISODate(interview.birthDate),
            interviewDate: toISODate(interview.interviewDate),
            entryDate: toISODate(interview.entryDate)
        });
        setIsModalOpen(true);
    };

    // Handoff recruiting → staffing (R-C3): porta i dati del candidato assunto
    // nella creazione di una nuova Risorsa, pre-compilando il form (i campi
    // obbligatori mancanti restano da completare prima del salvataggio).
    const createResourceFromCandidate = (interview: Interview | Omit<Interview, 'id'>) => {
        const fullName = `${interview.candidateName ?? ''} ${interview.candidateSurname ?? ''}`.trim();
        if (!fullName) {
            addToast('Inserisci nome e cognome del candidato prima di creare la risorsa.', 'error');
            return;
        }
        const prefillResource = {
            name: fullName,
            roleId: interview.roleId || '',
            function: interview.function || '',
            hireDate: toISODate(interview.entryDate) || '',
            notes: interview.cvSummary || interview.notes || '',
        };
        addToast(`Completa i dati anagrafici per assumere ${fullName}.`, 'info');
        navigate('/resources', { state: { prefillResource } });
    };

    // Handoff recruiting → staffing (R-C4): chiude la richiesta risorsa collegata
    // una volta coperta dall'assunzione, evitando richieste "orfane" ancora aperte.
    const linkedOpenRequest = useMemo(() => {
        if (!editingInterview?.resourceRequestId) return null;
        const req = resourceRequests.find(r => r.id === editingInterview.resourceRequestId);
        return req && req.status === 'ATTIVA' ? req : null;
    }, [editingInterview, resourceRequests]);

    const closeLinkedRequest = async () => {
        if (!linkedOpenRequest) return;
        try {
            await updateResourceRequest({ ...linkedOpenRequest, status: 'CHIUSA' });
            addToast(`Richiesta ${linkedOpenRequest.requestCode || ''} chiusa.`, 'success');
        } catch (err) {
            console.error(err);
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingInterview) return;
        try {
            const payload = buildInterviewPayload(editingInterview);
            if ('id' in payload) await updateInterview(payload as Interview);
            else await addInterview(payload as Omit<Interview, 'id'>);
            setIsModalOpen(false);
            addToast('Colloquio salvato con successo', 'success');
        } catch (e) {
            addToast('Errore durante il salvataggio del colloquio.', 'error');
        }
    };

    const handleRatingChange = (field: keyof Interview, value: number) => {
        if (editingInterview) setEditingInterview({ ...editingInterview, [field]: value });
    };

    const RatingStarsInput: React.FC<{ value: number | null | undefined, onChange?: (v: number) => void, label: string }> = ({ value, onChange, label }) => (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{label}</span>
            <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(star => (
                    <button 
                        key={star} 
                        type="button"
                        onClick={() => onChange?.(star)}
                        className={`material-symbols-outlined text-xl transition-colors ${star <= (value || 0) ? 'text-tertiary fill-1' : 'text-outline-variant'}`}
                        style={{ fontVariationSettings: star <= (value || 0) ? "'FILL' 1" : "'FILL' 0" }}
                    >
                        star
                    </button>
                ))}
            </div>
        </div>
    );

    const columns: ColumnDef<EnrichedInterview>[] = [
        { header: 'Candidato', sortKey: 'candidateSurname', cell: i => (
            <div className="flex flex-col sticky left-0 bg-inherit">
                <span className="font-bold text-on-surface">{i.candidateName} {i.candidateSurname} <span className="text-on-surface-variant font-normal opacity-70">({i.age})</span></span>
            </div>
        )},
        { header: 'Ruolo Proposto', sortKey: 'roleName', cell: i => <span className="text-sm">{i.roleName}</span> },
        { header: 'COLLOQUIATO DA', cell: i => <span className="text-xs text-on-surface-variant truncate block max-w-[180px]" title={i.interviewersNames.join(', ')}>{i.interviewersNames.join(', ') || '-'}</span> },
        { header: 'Valutazione', sortKey: 'averageRating', cell: i => <RatingStarsDisplay value={i.averageRating} /> },
        { header: 'Data', sortKey: 'interviewDate', cell: i => <span className="text-sm font-medium">{formatDateFull(i.interviewDate)}</span> },
        { header: 'Feedback', sortKey: 'feedback', cell: i => i.feedback ? (
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${i.feedback === 'Positivo' ? 'bg-tertiary-container text-on-tertiary-container' : i.feedback === 'Negativo' ? 'bg-error-container text-on-error-container' : 'bg-yellow-container text-on-yellow-container'}`}>
                {i.feedback}
            </span>
        ) : '-' },
        { header: 'Stato', sortKey: 'status', cell: i => <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase bg-surface-container-high text-on-surface-variant">{i.status}</span> },
    ];

    const renderRow = (i: EnrichedInterview) => (
        <tr key={i.id} className="hover:bg-surface-container-low transition-colors border-b border-outline-variant/30">
            {columns.map((col, idx) => <td key={idx} className="px-6 py-4 whitespace-nowrap bg-inherit">{col.cell(i)}</td>)}
            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium bg-inherit">
                 <div className="flex items-center justify-end gap-2">
                    <button onClick={() => openModalForEdit(i)} className="p-2 rounded-full text-on-surface-variant hover:text-primary transition-colors"><span className="material-symbols-outlined text-xl">edit_note</span></button>
                    <button onClick={() => setInterviewToDelete(i)} className="p-2 rounded-full text-on-surface-variant hover:text-error transition-colors"><span className="material-symbols-outlined text-xl">delete</span></button>
                </div>
            </td>
        </tr>
    );

    const renderCard = (i: EnrichedInterview) => (
        <div key={i.id} className="p-4 rounded-2xl shadow-md bg-surface-container-low border border-outline-variant flex flex-col gap-3">
             <div className="flex justify-between items-start">
                <div className="flex flex-col min-w-0">
                    <h3 className="font-bold text-on-surface">{i.candidateName} {i.candidateSurname}</h3>
                    <p className="text-xs text-on-surface-variant">{i.roleName}</p>
                </div>
                <div className="flex gap-1">
                    <button onClick={() => openModalForEdit(i)} className="p-1.5 rounded-full hover:bg-surface-container"><span className="material-symbols-outlined text-xl">edit_note</span></button>
                    <button onClick={() => setInterviewToDelete(i)} className="p-1.5 rounded-full hover:bg-surface-container text-error"><span className="material-symbols-outlined text-xl">delete</span></button>
                </div>
            </div>
            <div className="flex justify-between items-center text-xs mt-1 pt-2 border-t border-outline-variant/30">
                <RatingStarsDisplay value={i.averageRating} />
                <span className="font-bold text-primary uppercase">{i.status}</span>
            </div>
        </div>
    );

    const buildPdfConfig = useCallback((): PdfExportConfig => {
      const feedbackCounts: Record<string, number> = {};
      const statusCounts: Record<string, number> = {};
      dataForTable.forEach(i => {
        const fb = i.feedback || 'Non definito';
        feedbackCounts[fb] = (feedbackCounts[fb] || 0) + 1;
        const st = i.status || 'Non definito';
        statusCounts[st] = (statusCounts[st] || 0) + 1;
      });

      return {
        title: 'Report Colloqui',
        subtitle: `Totale: ${dataForTable.length} colloqui`,
        charts: [
          {
            title: 'Distribuzione Esito Colloquio',
            chartJs: {
              type: 'doughnut',
              data: {
                labels: Object.keys(feedbackCounts),
                datasets: [{ data: Object.values(feedbackCounts), backgroundColor: CHART_PALETTE }],
              },
              options: { plugins: { legend: { position: 'bottom' } } },
            },
          },
          {
            title: 'Distribuzione Stato Processo',
            chartJs: {
              type: 'bar',
              data: {
                labels: Object.keys(statusCounts),
                datasets: [{ label: 'Colloqui', data: Object.values(statusCounts), backgroundColor: CHART_PALETTE[1] }],
              },
              options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
            },
          },
        ],
        tables: [
          {
            title: 'Elenco Colloqui',
            head: [['Candidato', 'Ruolo', 'Function', 'Stato', 'Esito', 'Data', 'Valutazione']],
            body: exportData.map(row => [
              String(row['Candidato'] ?? ''),
              String(row['Ruolo Proposto'] ?? ''),
              String(row['Function'] ?? ''),
              String(row['Stato Processo'] ?? ''),
              String(row['Esito Colloquio'] ?? ''),
              String(row['Data Colloquio'] ?? ''),
              String(row['Valutazione'] ?? ''),
            ]),
          },
        ],
      };
    }, [dataForTable, exportData]);

    if (!hasEntityVisibility('interviews')) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
                <span className="material-symbols-outlined text-5xl text-on-surface-variant">lock</span>
                <p className="text-on-surface-variant font-bold">Non hai i permessi per visualizzare i Colloqui.</p>
                <p className="text-xs text-on-surface-variant">Contatta un amministratore per richiedere l'accesso.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* KPI Section */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-surface rounded-2xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-on-surface-variant opacity-70">Candidati Attivi</p>
                    <p className="text-2xl font-black text-primary">{kpis.active}</p>
                </div>
                <div className="bg-surface rounded-2xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-on-surface-variant opacity-70">Feedback Positivi</p>
                    <p className="text-2xl font-black text-tertiary">{kpis.positive}</p>
                </div>
                <div className="bg-surface rounded-2xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-on-surface-variant opacity-70">In Offerta / Assunti</p>
                    <p className="text-2xl font-black text-secondary">{kpis.hired}</p>
                </div>
                <div className="bg-surface rounded-2xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-on-surface-variant opacity-70">StandBy</p>
                    <p className="text-2xl font-black text-error">{kpis.standby}</p>
                </div>
                <div className="bg-surface rounded-2xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-on-surface-variant opacity-70">Ingressi Previsti</p>
                    {kpis.incoming ? (
                        <div className="mt-1">
                            <p className="text-sm font-bold text-on-surface truncate">{kpis.incoming.candidateName}</p>
                            <p className="text-[10px] text-primary font-bold">{formatDateFull(kpis.incoming.entryDate)}</p>
                        </div>
                    ) : (
                        <p className="text-xs text-on-surface-variant mt-1 italic">Nessun ingresso previsto.</p>
                    )}
                </div>
            </div>

            <DataTable<EnrichedInterview>
                title="Gestione Colloqui"
                addNewButtonLabel="Nuovo Colloquio"
                onAddNew={openModalForNew}
                data={dataForTable}
                columns={columns}
                headerActions={<><ExportButton data={exportData} title="Report Colloqui" icon="content_copy" label="Esporta" /><PdfExportButton buildConfig={buildPdfConfig} /></>}
                filtersNode={
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                        <div className="md:col-span-1">
                            <input type="text" className="form-input" placeholder="Cerca candidato..." value={filters.name} onChange={e => setFilters({...filters, name: e.target.value})} />
                        </div>
                        <MultiSelectDropdown name="roleId" selectedValues={filters.roleId} onChange={(_, v) => setFilters({...filters, roleId: v})} options={roles.map(r => ({ value: r.id!, label: r.name }))} placeholder="Ruolo" />
                        <MultiSelectDropdown name="status" selectedValues={filters.status} onChange={(_, v) => setFilters({...filters, status: v})} options={[{value: 'Aperto', label: 'Aperto'}, {value: 'Chiuso', label: 'Chiuso'}, {value: 'StandBy', label: 'StandBy'}]} placeholder="Stato Processo" />
                        <MultiSelectDropdown name="feedback" selectedValues={filters.feedback} onChange={(_, v) => setFilters({...filters, feedback: v})} options={[{value: 'Positivo', label: 'Positivo'}, {value: 'Negativo', label: 'Negativo'}, {value: 'Positivo On Hold', label: 'On Hold'}]} placeholder="Feedback" />
                        <button onClick={() => setFilters({ name: '', roleId: [], status: [], feedback: [] })} className="bg-secondary-container text-on-secondary-container py-3 px-6 rounded-full font-bold text-sm shadow-sm hover:opacity-90">Reset</button>
                    </div>
                }
                renderRow={renderRow}
                renderMobileCard={renderCard}
                isLoading={loading}
                initialSortKey="candidateSurname"
                numActions={2}
                tableLayout={{ dense: true, striped: true, headerSticky: true, headerBackground: true, headerBorder: true }}
            />

            {/* Edit Modal */}
            {isModalOpen && editingInterview && (
                <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={'id' in editingInterview ? "Dettagli Colloquio" : "Nuovo Inserimento"}>
                    <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant md:col-span-2">
                            <h4 className="text-sm font-bold text-primary mb-4 uppercase tracking-wider flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">person</span> Anagrafica Candidato
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Nome *</label>
                                    <input type="text" required name="candidateName" value={editingInterview.candidateName} onChange={(e) => setEditingInterview({...editingInterview, candidateName: e.target.value})} className="form-input" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Cognome *</label>
                                    <input type="text" required name="candidateSurname" value={editingInterview.candidateSurname} onChange={(e) => setEditingInterview({...editingInterview, candidateSurname: e.target.value})} className="form-input" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Data di Nascita</label>
                                    <input type="date" name="birthDate" value={editingInterview.birthDate || ''} onChange={(e) => setEditingInterview({...editingInterview, birthDate: e.target.value})} className="form-input" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Data Colloquio *</label>
                                    <input type="date" required name="interviewDate" value={editingInterview.interviewDate || ''} onChange={(e) => setEditingInterview({...editingInterview, interviewDate: e.target.value})} className="form-input" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant md:col-span-2">
                            <h4 className="text-sm font-bold text-primary mb-4 uppercase tracking-wider flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">work</span> Proposta & Target
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Richiesta Correlata</label>
                                    <SearchableSelect name="resourceRequestId" value={editingInterview.resourceRequestId || ''} onChange={(_, v) => setEditingInterview({...editingInterview, resourceRequestId: v})} options={resourceRequests.map(r => ({ value: r.id!, label: `${r.requestCode} - ${roles.find(ro => ro.id === r.roleId)?.name}` }))} placeholder="Seleziona richiesta aperta (opzionale)" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Ruolo Proposto</label>
                                    <SearchableSelect name="roleId" value={editingInterview.roleId || ''} onChange={(_, v) => setEditingInterview({...editingInterview, roleId: v})} options={roles.map(r => ({ value: r.id!, label: r.name }))} placeholder="Scegli ruolo..." />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Function Target</label>
                                    <SearchableSelect name="function" value={editingInterview.function || ''} onChange={(_, v) => setEditingInterview({...editingInterview, function: v})} options={functions.map(h => ({ value: h.value, label: h.value }))} placeholder="Scegli Function..." />
                                </div>
                            </div>
                        </div>

                        <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant md:col-span-2">
                             <h4 className="text-sm font-bold text-primary mb-4 uppercase tracking-wider flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">star</span> Valutazione Skills
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-3">
                                    <RatingStarsInput label="Technical Mastery" value={editingInterview.ratingTechnicalMastery} onChange={v => handleRatingChange('ratingTechnicalMastery', v)} />
                                    <RatingStarsInput label="Problem Solving" value={editingInterview.ratingProblemSolving} onChange={v => handleRatingChange('ratingProblemSolving', v)} />
                                    <RatingStarsInput label="Method & Quality" value={editingInterview.ratingMethodQuality} onChange={v => handleRatingChange('ratingMethodQuality', v)} />
                                    <RatingStarsInput label="Domain Knowledge" value={editingInterview.ratingDomainKnowledge} onChange={v => handleRatingChange('ratingDomainKnowledge', v)} />
                                </div>
                                <div className="space-y-3">
                                    <RatingStarsInput label="Autonomia" value={editingInterview.ratingAutonomy} onChange={v => handleRatingChange('ratingAutonomy', v)} />
                                    <RatingStarsInput label="Comunicazione" value={editingInterview.ratingCommunication} onChange={v => handleRatingChange('ratingCommunication', v)} />
                                    <RatingStarsInput label="Proattività" value={editingInterview.ratingProactivity} onChange={v => handleRatingChange('ratingProactivity', v)} />
                                    <RatingStarsInput label="Team Fit" value={editingInterview.ratingTeamFit} onChange={v => handleRatingChange('ratingTeamFit', v)} />
                                </div>
                            </div>
                        </div>

                        <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant md:col-span-2">
                            <h4 className="text-sm font-bold text-primary mb-4 uppercase tracking-wider flex items-center gap-2">
                                <span className="material-symbols-outlined text-lg">assignment_turned_in</span> Esito & Decisione
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Feedback Colloquio</label>
                                    <select name="feedback" value={editingInterview.feedback || ''} onChange={(e) => setEditingInterview({...editingInterview, feedback: e.target.value as InterviewFeedback})} className="form-select">
                                        <option value="">Nessuno</option>
                                        <option value="Positivo">Positivo</option>
                                        <option value="Positivo On Hold">Positivo On Hold</option>
                                        <option value="Negativo">Negativo</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Stato Assunzione</label>
                                    <select name="hiringStatus" value={editingInterview.hiringStatus || ''} onChange={(e) => setEditingInterview({...editingInterview, hiringStatus: e.target.value as InterviewHiringStatus})} className="form-select">
                                        <option value="">In corso</option>
                                        <option value="SI">SI (Assunto)</option>
                                        <option value="In Fase di Offerta">In Fase di Offerta</option>
                                        <option value="No Rifiutato">No (Candidato Rifiutato)</option>
                                        <option value="NO">NO (Scartato)</option>
                                    </select>
                                </div>
                                {editingInterview.hiringStatus === 'SI' && (
                                    <div className="animate-fade-in md:col-span-2 space-y-3">
                                        <div>
                                            <label className="block text-[10px] font-bold text-tertiary uppercase mb-1">Data Ingresso Prevista</label>
                                            <input type="date" name="entryDate" value={editingInterview.entryDate || ''} onChange={(e) => setEditingInterview({...editingInterview, entryDate: e.target.value})} className="form-input border-tertiary/30" />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => createResourceFromCandidate(editingInterview)}
                                            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-tertiary-container text-on-tertiary-container font-bold text-sm hover:opacity-90 transition-opacity"
                                        >
                                            <span className="material-symbols-outlined text-lg" aria-hidden="true">person_add</span>
                                            Crea risorsa da questo candidato
                                        </button>
                                        <p className="text-[11px] text-on-surface-variant">Apre la creazione di una nuova risorsa pre-compilata con i dati del candidato. Completa gli altri campi (email, sede…) prima di salvare.</p>
                                        {linkedOpenRequest && (
                                            <button
                                                type="button"
                                                onClick={closeLinkedRequest}
                                                disabled={isActionLoading(`updateResourceRequest-${linkedOpenRequest.id}`)}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-outline text-primary font-bold text-sm hover:bg-surface-container transition-colors disabled:opacity-50"
                                            >
                                                <span className="material-symbols-outlined text-lg" aria-hidden="true">assignment_turned_in</span>
                                                Chiudi richiesta collegata ({linkedOpenRequest.requestCode || 'senza codice'})
                                            </button>
                                        )}
                                    </div>
                                )}
                                <div className="md:col-span-2">
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Intervistatori</label>
                                    <MultiSelectDropdown name="interviewersIds" selectedValues={editingInterview.interviewersIds || []} onChange={(_, v) => setEditingInterview({...editingInterview, interviewersIds: v})} options={resources.filter(r => !r.resigned).map(r => ({ value: r.id!, label: r.name }))} placeholder="Chi ha fatto il colloquio?" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Note & Sintesi CV</label>
                                    <textarea name="notes" value={editingInterview.notes || ''} onChange={(e) => setEditingInterview({...editingInterview, notes: e.target.value})} className="form-textarea" rows={3} placeholder="Sintesi valutazione, preavviso..."></textarea>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-1">Stato Processo *</label>
                                    <select name="status" required value={editingInterview.status} onChange={(e) => setEditingInterview({...editingInterview, status: e.target.value as InterviewStatus})} className="form-select">
                                        <option value="Aperto">Aperto</option>
                                        <option value="StandBy">StandBy</option>
                                        <option value="Chiuso">Chiuso</option>
                                        <option value="Non Contattabile">Non Contattabile</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant md:col-span-2 mt-4">
                            <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2 border border-outline rounded-full text-primary font-bold">Annulla</button>
                            <button type="submit" disabled={isActionLoading('addInterview') || isActionLoading(`updateInterview-${'id' in editingInterview ? editingInterview.id : ''}`)} className="px-8 py-2 bg-primary text-on-primary rounded-full font-bold shadow-lg">
                                {isActionLoading('addInterview') ? <SpinnerIcon className="w-5 h-5"/> : 'Salva'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {interviewToDelete && (
                <ConfirmationModal 
                    isOpen={!!interviewToDelete} 
                    onClose={() => setInterviewToDelete(null)} 
                    onConfirm={async () => {
                         try {
                            await deleteInterview(interviewToDelete.id!);
                            addToast('Colloquio eliminato.', 'success');
                            setInterviewToDelete(null);
                        } catch (e) {
                            addToast('Errore durante l\'eliminazione del colloquio.', 'error');
                        }
                    }} 
                    title="Elimina Candidato" 
                    message={<>Sei sicuro di voler eliminare permanentemente <strong>{interviewToDelete.candidateName} {interviewToDelete.candidateSurname}</strong>?</>}
                    isConfirming={isActionLoading(`deleteInterview-${interviewToDelete.id}`)}
                />
            )}
        </div>
    );
};

export default InterviewsPage;
