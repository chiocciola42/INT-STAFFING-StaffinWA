/**
 * @file HRContext.tsx
 * @description Contesto HR per la gestione di assenze, richieste di risorse e colloqui.
 * Gestisce: leaveRequests, leaveTypes, resourceRequests, interviews.
 */

import React, { createContext, useState, useContext, useCallback, useMemo, ReactNode } from 'react';
import {
    LeaveRequest, LeaveType, ResourceRequest, Interview
} from '../types';
import { useToast } from './ToastContext';
import { apiFetch } from '../services/apiClient';

// --- Tipi del contesto ---

export interface HRInitData {
    leaveTypes?: LeaveType[];
    leaveRequests?: LeaveRequest[];
    resourceRequests?: ResourceRequest[];
    interviews?: Interview[];
}

export interface HRContextValue {
    // Stato
    leaveRequests: LeaveRequest[];
    leaveTypes: LeaveType[];
    resourceRequests: ResourceRequest[];
    interviews: Interview[];
    // CRUD Leave Types
    addLeaveType: (type: Omit<LeaveType, 'id'>) => Promise<void>;
    updateLeaveType: (type: LeaveType) => Promise<void>;
    deleteLeaveType: (id: string) => Promise<void>;
    // CRUD Leave Requests
    addLeaveRequest: (req: Omit<LeaveRequest, 'id'>) => Promise<void>;
    updateLeaveRequest: (req: LeaveRequest) => Promise<void>;
    deleteLeaveRequest: (id: string) => Promise<void>;
    // CRUD Resource Requests
    addResourceRequest: (req: Omit<ResourceRequest, 'id'>) => Promise<void>;
    updateResourceRequest: (req: ResourceRequest) => Promise<void>;
    deleteResourceRequest: (id: string) => Promise<void>;
    // CRUD Interviews
    addInterview: (interview: Omit<Interview, 'id'>) => Promise<void>;
    updateInterview: (interview: Interview) => Promise<void>;
    deleteInterview: (id: string) => Promise<void>;
    // Utility
    getBestFitResources: (params: {
        startDate: string; endDate: string; roleId: string;
        projectId: string; commitmentPercentage: number
    }) => Promise<any[]>;
    // Funzioni interne per il coordinator (cascade)
    initialize: (data: HRInitData, setActionLoadingFn?: (action: string, loading: boolean) => void) => void;
    _removeLeaveRequestsByResource: (resourceId: string) => void;
    _setActionLoading?: (action: string, loading: boolean) => void;
}

const HRContext = createContext<HRContextValue | undefined>(undefined);

export const HRProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { addToast } = useToast();

    const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [resourceRequests, setResourceRequests] = useState<ResourceRequest[]>([]);
    const [interviews, setInterviews] = useState<Interview[]>([]);

    const [actionLoading, setActionLoading] = useState<(action: string, loading: boolean) => void>(() => () => {});

    const initialize = useCallback((data: HRInitData, setActionLoadingFn?: (action: string, loading: boolean) => void) => {
        if (data.leaveTypes !== undefined) setLeaveTypes(data.leaveTypes);
        if (data.leaveRequests !== undefined) setLeaveRequests(data.leaveRequests);
        if (data.resourceRequests !== undefined) setResourceRequests(data.resourceRequests);
        if (data.interviews !== undefined) setInterviews(data.interviews);
        if (setActionLoadingFn) setActionLoading(() => setActionLoadingFn);
    }, []);

    const _removeLeaveRequestsByResource = useCallback((resourceId: string) => {
        setLeaveRequests(prev => prev.filter(lr => lr.resourceId !== resourceId));
    }, []);

    // --- CRUD Leave Types ---
    const addLeaveType = useCallback(async (type: Omit<LeaveType, 'id'>): Promise<void> => {
        try {
            const created = await apiFetch<LeaveType>('/api/resources?entity=leave_types', {
                method: 'POST', body: JSON.stringify(type)
            });
            setLeaveTypes(prev => [...prev, created]);
        } catch (e) { addToast('Errore durante l\'aggiunta del tipo di assenza.', 'error'); }
    }, [addToast]);

    const updateLeaveType = useCallback(async (type: LeaveType): Promise<void> => {
        try {
            const updated = await apiFetch<LeaveType>(
                `/api/resources?entity=leave_types&id=${type.id}`,
                { method: 'PUT', body: JSON.stringify(type) }
            );
            setLeaveTypes(prev => prev.map(t => t.id === type.id ? updated : t));
        } catch (e) { addToast('Errore durante l\'aggiornamento del tipo di assenza.', 'error'); }
    }, [addToast]);

    const deleteLeaveType = useCallback(async (id: string): Promise<void> => {
        try {
            await apiFetch(`/api/resources?entity=leave_types&id=${id}`, { method: 'DELETE' });
            setLeaveTypes(prev => prev.filter(t => t.id !== id));
        } catch (e) { addToast('Errore durante l\'eliminazione del tipo di assenza.', 'error'); }
    }, [addToast]);

    // --- CRUD Leave Requests ---
    const addLeaveRequest = useCallback(async (req: Omit<LeaveRequest, 'id'>): Promise<void> => {
        actionLoading('addLeaveRequest', true);
        try {
            const created = await apiFetch<LeaveRequest>('/api/resources?entity=leaves', {
                method: 'POST', body: JSON.stringify(req)
            });
            setLeaveRequests(prev => [...prev, created]);
        } catch (e) { addToast('Errore durante l\'aggiunta della richiesta di assenza.', 'error'); }
        finally { actionLoading('addLeaveRequest', false); }
    }, [addToast, actionLoading]);

    const updateLeaveRequest = useCallback(async (req: LeaveRequest): Promise<void> => {
        actionLoading(`updateLeaveRequest-${req.id}`, true);
        try {
            const updated = await apiFetch<LeaveRequest>(
                `/api/resources?entity=leaves&id=${req.id}`,
                { method: 'PUT', body: JSON.stringify(req) }
            );
            setLeaveRequests(prev => prev.map(r => r.id === req.id ? updated : r));
        } catch (e) { addToast('Errore durante l\'aggiornamento della richiesta di assenza.', 'error'); }
        finally { actionLoading(`updateLeaveRequest-${req.id}`, false); }
    }, [addToast, actionLoading]);

    const deleteLeaveRequest = useCallback(async (id: string): Promise<void> => {
        actionLoading(`deleteLeaveRequest-${id}`, true);
        try {
            await apiFetch(`/api/resources?entity=leaves&id=${id}`, { method: 'DELETE' });
            setLeaveRequests(prev => prev.filter(r => r.id !== id));
        } catch (e) { addToast('Errore durante l\'eliminazione della richiesta di assenza.', 'error'); }
        finally { actionLoading(`deleteLeaveRequest-${id}`, false); }
    }, [addToast, actionLoading]);

    // --- CRUD Resource Requests ---
    const addResourceRequest = useCallback(async (req: Omit<ResourceRequest, 'id'>): Promise<void> => {
        actionLoading('addResourceRequest', true);
        try {
            const created = await apiFetch<ResourceRequest>('/api/resources?entity=resource_requests', {
                method: 'POST', body: JSON.stringify(req)
            });
            setResourceRequests(prev => [...prev, created]);
        } catch (e) { addToast('Errore durante l\'aggiunta della richiesta risorsa.', 'error'); throw e; }
        finally { actionLoading('addResourceRequest', false); }
    }, [addToast, actionLoading]);

    const updateResourceRequest = useCallback(async (req: ResourceRequest): Promise<void> => {
        actionLoading(`updateResourceRequest-${req.id}`, true);
        try {
            const updated = await apiFetch<ResourceRequest>(
                `/api/resources?entity=resource_requests&id=${req.id}`,
                { method: 'PUT', body: JSON.stringify(req) }
            );
            setResourceRequests(prev => prev.map(r => r.id === req.id ? updated : r));
        } catch (e) { addToast('Errore durante l\'aggiornamento della richiesta risorsa.', 'error'); throw e; }
        finally { actionLoading(`updateResourceRequest-${req.id}`, false); }
    }, [addToast, actionLoading]);

    const deleteResourceRequest = useCallback(async (id: string): Promise<void> => {
        actionLoading(`deleteResourceRequest-${id}`, true);
        try {
            await apiFetch(`/api/resources?entity=resource_requests&id=${id}`, { method: 'DELETE' });
            setResourceRequests(prev => prev.filter(r => r.id !== id));
        } catch (e) { addToast('Errore durante l\'eliminazione della richiesta risorsa.', 'error'); }
        finally { actionLoading(`deleteResourceRequest-${id}`, false); }
    }, [addToast, actionLoading]);

    // --- CRUD Interviews ---
    const addInterview = useCallback(async (interview: Omit<Interview, 'id'>): Promise<void> => {
        actionLoading('addInterview', true);
        try {
            const created = await apiFetch<Interview>('/api/resources?entity=interviews', {
                method: 'POST', body: JSON.stringify(interview)
            });
            setInterviews(prev => [...prev, created]);
        } catch (e) { addToast('Errore durante l\'aggiunta del colloquio.', 'error'); }
        finally { actionLoading('addInterview', false); }
    }, [addToast, actionLoading]);

    const updateInterview = useCallback(async (interview: Interview): Promise<void> => {
        actionLoading(`updateInterview-${interview.id}`, true);
        try {
            const updated = await apiFetch<Interview>(
                `/api/resources?entity=interviews&id=${interview.id}`,
                { method: 'PUT', body: JSON.stringify(interview) }
            );
            setInterviews(prev => prev.map(i => i.id === interview.id ? updated : i));
        } catch (e) { addToast('Errore durante l\'aggiornamento del colloquio.', 'error'); }
        finally { actionLoading(`updateInterview-${interview.id}`, false); }
    }, [addToast, actionLoading]);

    const deleteInterview = useCallback(async (id: string): Promise<void> => {
        actionLoading(`deleteInterview-${id}`, true);
        try {
            await apiFetch(`/api/resources?entity=interviews&id=${id}`, { method: 'DELETE' });
            setInterviews(prev => prev.filter(i => i.id !== id));
        } catch (e) { addToast('Errore durante l\'eliminazione del colloquio.', 'error'); }
        finally { actionLoading(`deleteInterview-${id}`, false); }
    }, [addToast, actionLoading]);

    // --- Utility ---
    const getBestFitResources = useCallback(async (params: any): Promise<any[]> => {
        try {
            return await apiFetch<any[]>('/api/resources?entity=resources&action=best_fit', {
                method: 'POST', body: JSON.stringify(params)
            });
        } catch (e) { return []; }
    }, []);

    const value = useMemo<HRContextValue>(() => ({
        leaveRequests, leaveTypes, resourceRequests, interviews,
        addLeaveType, updateLeaveType, deleteLeaveType,
        addLeaveRequest, updateLeaveRequest, deleteLeaveRequest,
        addResourceRequest, updateResourceRequest, deleteResourceRequest,
        addInterview, updateInterview, deleteInterview,
        getBestFitResources,
        initialize, _removeLeaveRequestsByResource,
        _setActionLoading: actionLoading
    }), [
        leaveRequests, leaveTypes, resourceRequests, interviews,
        addLeaveType, updateLeaveType, deleteLeaveType,
        addLeaveRequest, updateLeaveRequest, deleteLeaveRequest,
        addResourceRequest, updateResourceRequest, deleteResourceRequest,
        addInterview, updateInterview, deleteInterview,
        getBestFitResources,
        initialize, _removeLeaveRequestsByResource,
        actionLoading
    ]);

    return <HRContext.Provider value={value}>{children}</HRContext.Provider>;
};

export const useHRContext = (): HRContextValue => {
    const ctx = useContext(HRContext);
    if (!ctx) throw new Error('useHRContext must be used within HRProvider');
    return ctx;
};
