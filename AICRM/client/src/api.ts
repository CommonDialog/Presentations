import { Contact, LeadList, LeadListSummary, SessionInfo } from './types';

const TOKEN_KEY = 'aicrm_jwt_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    apiRequest<SessionInfo & { token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => apiRequest<SessionInfo>('/api/auth/me'),

  updateSettings: (payload: {
    apiKey?: string;
    vertexProject?: string;
    vertexLocation?: string;
    useVertex?: boolean;
  }) =>
    apiRequest<SessionInfo & { message: string }>('/api/auth/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getLists: async (): Promise<LeadListSummary[]> => {
    const res = await apiRequest<LeadListSummary[] | { lists: LeadListSummary[] }>('/api/lists');
    return Array.isArray(res) ? res : res.lists;
  },

  getList: async (id: string): Promise<LeadList> => {
    const res = await apiRequest<LeadList | { list: LeadList }>(`/api/lists/${id}`);
    return 'list' in res && res.list ? res.list : (res as LeadList);
  },

  searchNewList: async (name: string, criteria: string): Promise<LeadList> => {
    const res = await apiRequest<LeadList | { list: LeadList }>('/api/lists/search', {
      method: 'POST',
      body: JSON.stringify({ name, criteria }),
    });
    return 'list' in res && res.list ? res.list : (res as LeadList);
  },

  appendList: async (id: string): Promise<LeadList> => {
    const res = await apiRequest<LeadList | { list: LeadList }>(`/api/lists/${id}/append`, {
      method: 'POST',
    });
    return 'list' in res && res.list ? res.list : (res as LeadList);
  },

  updateList: async (id: string, updates: { name?: string; criteria?: string }): Promise<LeadList> => {
    const res = await apiRequest<LeadList | { list: LeadList }>(`/api/lists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    return 'list' in res && res.list ? res.list : (res as LeadList);
  },

  deleteList: (id: string) =>
    apiRequest<{ success: boolean }>(`/api/lists/${id}`, {
      method: 'DELETE',
    }),

  addContact: async (listId: string, contact: Partial<Contact>): Promise<Contact> => {
    const res = await apiRequest<Contact | { contact: Contact }>(`/api/lists/${listId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(contact),
    });
    return 'contact' in res && res.contact ? res.contact : (res as Contact);
  },

  updateContact: async (
    listId: string,
    contactId: string,
    updates: Partial<Contact>
  ): Promise<Contact> => {
    const res = await apiRequest<Contact | { contact: Contact }>(
      `/api/lists/${listId}/contacts/${contactId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }
    );
    return 'contact' in res && res.contact ? res.contact : (res as Contact);
  },

  deleteContact: (listId: string, contactId: string) =>
    apiRequest<{ success: boolean }>(`/api/lists/${listId}/contacts/${contactId}`, {
      method: 'DELETE',
    }),

  enrichContact: async (listId: string, contactId: string): Promise<Contact> => {
    const res = await apiRequest<Contact | { contact: Contact }>(
      `/api/lists/${listId}/contacts/${contactId}/enrich`,
      {
        method: 'POST',
      }
    );
    return 'contact' in res && res.contact ? res.contact : (res as Contact);
  },

  generateCallScript: async (listId: string, contactId: string): Promise<Contact> => {
    const res = await apiRequest<{ contact: Contact; callScript: string }>(
      `/api/lists/${listId}/contacts/${contactId}/script`,
      {
        method: 'POST',
      }
    );
    return res.contact;
  },

  generateEmail: async (listId: string, contactId: string): Promise<Contact> => {
    const res = await apiRequest<{ contact: Contact; emailSubject: string; emailBody: string }>(
      `/api/lists/${listId}/contacts/${contactId}/email`,
      {
        method: 'POST',
      }
    );
    return res.contact;
  },

  exportCsv: async (listId: string, listName: string) => {
    const token = getStoredToken();
    const res = await fetch(`/api/lists/${listId}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error('Failed to export CSV');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${listName.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() || 'leads'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
