import React, { useState, useEffect } from 'react';
import {
  Search,
  Plus,
  Download,
  Trash2,
  Settings,
  LogOut,
  Users,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Edit3,
  UserPlus,
  Loader2,
  PhoneCall,
  Mail,
  Send,
  Copy,
  RefreshCw,
  Zap,
  ArrowUpDown,
} from 'lucide-react';
import { api, getStoredToken, setStoredToken } from './api';
import {
  Contact,
  ContactStatus,
  LeadList,
  LeadListSummary,
  ReadinessTier,
  SessionInfo,
} from './types';
import { getLeadReadiness } from './scoring';

const STATUS_OPTIONS: ContactStatus[] = ['New', 'Contacted', 'Qualified', 'Disqualified'];

const STATUS_BADGE: Record<ContactStatus, string> = {
  New: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  Contacted: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Qualified: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Disqualified: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

const TIER_BADGE: Record<ReadinessTier, string> = {
  Hot: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Warm: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Cold: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [lists, setLists] = useState<LeadListSummary[]>([]);
  const [selectedList, setSelectedList] = useState<LeadList | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState('');
  const [sortByScore, setSortByScore] = useState(false);

  const [showNewSearch, setShowNewSearch] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListCriteria, setNewListCriteria] = useState('');
  const [searching, setSearching] = useState(false);
  const [appending, setAppending] = useState(false);
  const [errorBanner, setErrorBanner] = useState('');

  const [editingContact, setEditingContact] = useState<Partial<Contact> | null>(null);
  const [isNewContact, setIsNewContact] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  const [enrichingIds, setEnrichingIds] = useState<Record<string, boolean>>({});
  const [scriptContact, setScriptContact] = useState<Contact | null>(null);
  const [scriptText, setScriptText] = useState('');
  const [generatingScript, setGeneratingScript] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const [emailContact, setEmailContact] = useState<Contact | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    api
      .me()
      .then((info) => {
        setSession(info);
        return refreshLists();
      })
      .catch(() => {
        setStoredToken(null);
      })
      .finally(() => setAuthChecking(false));
  }, []);

  async function refreshLists(selectId?: string) {
    const summaries = await api.getLists();
    setLists(summaries);
    const targetId = selectId || selectedList?.id || summaries[0]?.id;
    if (targetId) {
      const detail = await api.getList(targetId);
      setSelectedList(detail);
    } else {
      setSelectedList(null);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await api.login(username, password);
      setStoredToken(res.token);
      setSession(res);
      await refreshLists();
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    }
  }

  function handleLogout() {
    setStoredToken(null);
    setSession(null);
    setLists([]);
    setSelectedList(null);
  }

  async function handleCreateSearchList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListName.trim() || !newListCriteria.trim()) return;
    setSearching(true);
    setErrorBanner('');
    try {
      const created = await api.searchNewList(newListName.trim(), newListCriteria.trim());
      setShowNewSearch(false);
      setNewListName('');
      setNewListCriteria('');
      await refreshLists(created.id);
    } catch (err: any) {
      setErrorBanner(err.message || 'AI Search failed');
    } finally {
      setSearching(false);
    }
  }

  async function handleAppendLeads() {
    if (!selectedList) return;
    setAppending(true);
    setErrorBanner('');
    try {
      const updated = await api.appendList(selectedList.id);
      setSelectedList(updated);
      await refreshLists(updated.id);
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to append leads');
    } finally {
      setAppending(false);
    }
  }

  async function handleDeleteList(id: string) {
    try {
      await api.deleteList(id);
      const remaining = lists.filter((l) => l.id !== id);
      setLists(remaining);
      if (selectedList?.id === id) {
        if (remaining[0]) {
          const next = await api.getList(remaining[0].id);
          setSelectedList(next);
        } else {
          setSelectedList(null);
        }
      }
    } catch (err: any) {
      setErrorBanner(err.message);
    }
  }

  async function handleQuickStatusChange(contactId: string, status: ContactStatus) {
    if (!selectedList) return;
    try {
      const updated = await api.updateContact(selectedList.id, contactId, { status });
      setSelectedList({
        ...selectedList,
        contacts: selectedList.contacts.map((c) => (c.id === contactId ? updated : c)),
      });
    } catch (err: any) {
      setErrorBanner(err.message);
    }
  }

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedList || !editingContact) return;
    try {
      if (isNewContact) {
        const created = await api.addContact(selectedList.id, editingContact);
        setSelectedList({
          ...selectedList,
          contacts: [...selectedList.contacts, created],
        });
        await refreshLists(selectedList.id);
      } else if (editingContact.id) {
        const updated = await api.updateContact(
          selectedList.id,
          editingContact.id,
          editingContact
        );
        setSelectedList({
          ...selectedList,
          contacts: selectedList.contacts.map((c) => (c.id === updated.id ? updated : c)),
        });
      }
      setEditingContact(null);
    } catch (err: any) {
      setErrorBanner(err.message);
    }
  }

  async function handleDeleteContact(contactId: string) {
    if (!selectedList) return;
    try {
      await api.deleteContact(selectedList.id, contactId);
      setSelectedList({
        ...selectedList,
        contacts: selectedList.contacts.filter((c) => c.id !== contactId),
      });
      await refreshLists(selectedList.id);
    } catch (err: any) {
      setErrorBanner(err.message);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    try {
      const updated = await api.updateSettings({
        apiKey: apiKeyInput || undefined,
      });
      setSession(updated);
      setShowSettings(false);
      setApiKeyInput('');
    } catch (err: any) {
      setErrorBanner(err.message);
    }
  }

  async function handleEnrichContact(contact: Contact) {
    if (!selectedList) return;
    setEnrichingIds((prev) => ({ ...prev, [contact.id]: true }));
    setErrorBanner('');
    try {
      const updated = await api.enrichContact(selectedList.id, contact.id);
      setSelectedList((prev) =>
        prev
          ? {
              ...prev,
              contacts: prev.contacts.map((c) => (c.id === contact.id ? updated : c)),
            }
          : null
      );
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to enrich contact');
    } finally {
      setEnrichingIds((prev) => ({ ...prev, [contact.id]: false }));
    }
  }

  async function handleOpenCallScript(contact: Contact) {
    if (!selectedList) return;
    setScriptContact(contact);
    setScriptText(contact.callScript || '');
    setCopiedScript(false);

    if (!contact.callScript) {
      setGeneratingScript(true);
      setErrorBanner('');
      try {
        const updated = await api.generateCallScript(selectedList.id, contact.id);
        setScriptContact(updated);
        setScriptText(updated.callScript || '');
        setSelectedList((prev) =>
          prev
            ? {
                ...prev,
                contacts: prev.contacts.map((c) => (c.id === contact.id ? updated : c)),
              }
            : null
        );
      } catch (err: any) {
        setErrorBanner(err.message || 'Failed to generate call script');
      } finally {
        setGeneratingScript(false);
      }
    }
  }

  async function handleRegenerateCallScript() {
    if (!selectedList || !scriptContact) return;
    setGeneratingScript(true);
    setCopiedScript(false);
    setErrorBanner('');
    try {
      const updated = await api.generateCallScript(selectedList.id, scriptContact.id);
      setScriptContact(updated);
      setScriptText(updated.callScript || '');
      setSelectedList((prev) =>
        prev
          ? {
              ...prev,
              contacts: prev.contacts.map((c) => (c.id === scriptContact.id ? updated : c)),
            }
          : null
      );
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to regenerate call script');
    } finally {
      setGeneratingScript(false);
    }
  }

  async function handleSaveCallScript() {
    if (!selectedList || !scriptContact) return;
    try {
      const updated = await api.updateContact(selectedList.id, scriptContact.id, {
        callScript: scriptText,
      });
      setScriptContact(updated);
      setSelectedList((prev) =>
        prev
          ? {
              ...prev,
              contacts: prev.contacts.map((c) => (c.id === scriptContact.id ? updated : c)),
            }
          : null
      );
      setScriptContact(null);
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to save call script');
    }
  }

  async function handleOpenEmail(contact: Contact) {
    if (!selectedList) return;
    setEmailContact(contact);
    setEmailSubject(contact.emailSubject || '');
    setEmailBody(contact.emailBody || '');
    setCopiedEmail(false);

    if (!contact.emailSubject && !contact.emailBody) {
      setGeneratingEmail(true);
      setErrorBanner('');
      try {
        const updated = await api.generateEmail(selectedList.id, contact.id);
        setEmailContact(updated);
        setEmailSubject(updated.emailSubject || '');
        setEmailBody(updated.emailBody || '');
        setSelectedList((prev) =>
          prev
            ? {
                ...prev,
                contacts: prev.contacts.map((c) => (c.id === contact.id ? updated : c)),
              }
            : null
        );
      } catch (err: any) {
        setErrorBanner(err.message || 'Failed to generate outreach email');
      } finally {
        setGeneratingEmail(false);
      }
    }
  }

  async function handleRegenerateEmail() {
    if (!selectedList || !emailContact) return;
    setGeneratingEmail(true);
    setCopiedEmail(false);
    setErrorBanner('');
    try {
      const updated = await api.generateEmail(selectedList.id, emailContact.id);
      setEmailContact(updated);
      setEmailSubject(updated.emailSubject || '');
      setEmailBody(updated.emailBody || '');
      setSelectedList((prev) =>
        prev
          ? {
              ...prev,
              contacts: prev.contacts.map((c) => (c.id === emailContact.id ? updated : c)),
            }
          : null
      );
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to regenerate outreach email');
    } finally {
      setGeneratingEmail(false);
    }
  }

  async function handleSaveEmail() {
    if (!selectedList || !emailContact) return;
    try {
      const updated = await api.updateContact(selectedList.id, emailContact.id, {
        emailSubject,
        emailBody,
      });
      setEmailContact(updated);
      setSelectedList((prev) =>
        prev
          ? {
              ...prev,
              contacts: prev.contacts.map((c) => (c.id === emailContact.id ? updated : c)),
            }
          : null
      );
      setEmailContact(null);
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to save outreach email');
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading AICRM...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-5"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">AICRM</h1>
              <p className="text-xs text-slate-400">
                Vertex AI &amp; Gemini Grounded Lead Generation
              </p>
            </div>
          </div>

          {loginError && (
            <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm">
              {loginError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition"
          >
            Sign In
          </button>
        </form>
      </div>
    );
  }

  const filteredContacts = (selectedList?.contacts || []).filter((c) => {
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      c.businessName.toLowerCase().includes(q) ||
      c.contactName.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      c.address.toLowerCase().includes(q)
    );
  });

  const displayedContacts = sortByScore
    ? [...filteredContacts].sort((a, b) => {
        const diff = getLeadReadiness(b).score - getLeadReadiness(a).score;
        if (diff !== 0) return diff;
        return a.businessName.localeCompare(b.businessName);
      })
    : filteredContacts;

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <aside className="w-72 border-r border-slate-800 bg-slate-900/60 flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-white tracking-tight">AICRM</span>
              <span className="block text-[11px] text-slate-400">
                {session.mode === 'vertex-ai' ? 'Vertex AI Active' : 'Gemini API Mode'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(true)}
              title="Vertex AI & API Settings"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-3">
          <button
            onClick={() => setShowNewSearch(true)}
            className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition"
          >
            <Plus className="w-4 h-4" /> New AI Lead Search
          </button>
        </div>

        <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Saved Lead Lists ({lists.length})
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {lists.map((list) => {
            const active = selectedList?.id === list.id;
            return (
              <div
                key={list.id}
                onClick={async () => {
                  const full = await api.getList(list.id);
                  setSelectedList(full);
                }}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition ${
                  active
                    ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
                    : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{list.name}</div>
                  <div className="text-xs text-slate-400 truncate">{list.criteria}</div>
                </div>
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                    {list.contactCount}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteList(list.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-400"
                    title="Delete list"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {lists.length === 0 && (
            <div className="text-center py-8 px-4 text-xs text-slate-500">
              No lead lists yet. Click &ldquo;New AI Lead Search&rdquo; above to generate 20 grounded leads.
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-800 text-xs flex items-center justify-between text-slate-400">
          <span className="flex items-center gap-1.5">
            {session.hasApiKey ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            )}
            {session.mode === 'vertex-ai'
              ? `Vertex: ${session.vertexProject}`
              : session.hasApiKey
              ? 'API Key Configured'
              : 'Credentials Needed'}
          </span>
          <button
            onClick={() => setShowSettings(true)}
            className="text-indigo-400 hover:underline"
          >
            Configure
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {errorBanner && (
          <div className="m-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-sm flex items-center justify-between">
            <span>{errorBanner}</span>
            <button onClick={() => setErrorBanner('')} className="text-xs underline ml-4">
              Dismiss
            </button>
          </div>
        )}

        {selectedList ? (
          <>
            <header className="p-6 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">{selectedList.name}</h2>
                <p className="text-sm text-slate-400 mt-0.5">
                  Criteria: <span className="text-slate-200">{selectedList.criteria}</span>
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleAppendLeads}
                  disabled={appending}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-2 transition"
                >
                  {appending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {appending ? 'Searching 20 More...' : 'Find 20 More Leads'}
                </button>

                <button
                  onClick={() => {
                    setIsNewContact(true);
                    setEditingContact({
                      businessName: '',
                      contactName: '',
                      contactTitle: '',
                      phone: '',
                      email: '',
                      website: '',
                      address: '',
                      description: '',
                      sourceUrl: '',
                      notes: '',
                      status: 'New',
                    });
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium flex items-center gap-2 transition"
                >
                  <UserPlus className="w-4 h-4" /> Add Contact
                </button>

                <button
                  onClick={() => api.exportCsv(selectedList.id, selectedList.name)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium flex items-center gap-2 transition"
                >
                  <Download className="w-4 h-4" /> Export CSV
                </button>
              </div>
            </header>

            <div className="px-6 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-900/30">
              <div className="relative w-72">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter businesses, contacts, phone..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-1.5">
                {(['ALL', ...STATUS_OPTIONS] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      statusFilter === st
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {st}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSortByScore((v) => !v)}
                  aria-pressed={sortByScore}
                  className={`ml-2 px-3 py-1 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition ${
                    sortByScore
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  Sort by Score
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900/40">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase text-slate-400 bg-slate-900/80">
                      <th className="py-3 px-4">Business</th>
                      <th className="py-3 px-4">Contact</th>
                      <th className="py-3 px-4">Phone / Email</th>
                      <th className="py-3 px-4">Readiness</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Notes</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-sm">
                    {displayedContacts.map((contact) => {
                      const readiness = getLeadReadiness(contact);
                      return (
                      <tr key={contact.id} className="hover:bg-slate-800/30">
                        <td className="py-3.5 px-4 max-w-xs">
                          <div className="font-semibold text-white">{contact.businessName}</div>
                          <div className="text-xs text-slate-400 truncate">{contact.address}</div>
                          {contact.website && (
                            <a
                              href={contact.website}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline mt-0.5"
                            >
                              Website <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="text-slate-200">{contact.contactName || '—'}</div>
                          <div className="text-xs text-slate-500">{contact.contactTitle}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="text-slate-200">{contact.phone || '—'}</div>
                          <div className="text-xs text-slate-400">{contact.email}</div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-200 tabular-nums">
                              {readiness.score}/100
                            </span>
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                                TIER_BADGE[readiness.tier]
                              }`}
                            >
                              {readiness.tier}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <select
                            value={contact.status}
                            onChange={(e) =>
                              handleQuickStatusChange(
                                contact.id,
                                e.target.value as ContactStatus
                              )
                            }
                            className={`text-xs font-medium px-2.5 py-1 rounded-full border bg-transparent cursor-pointer ${
                              STATUS_BADGE[contact.status]
                            }`}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt} className="bg-slate-900 text-white">
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3.5 px-4 max-w-xs">
                          <p className="text-xs text-slate-300 line-clamp-2">
                            {contact.notes || contact.description || '—'}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => handleEnrichContact(contact)}
                              disabled={Boolean(enrichingIds[contact.id])}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-medium inline-flex items-center gap-1 disabled:opacity-50 transition cursor-pointer"
                              title="Pull contact details, phone, email, and description from web"
                            >
                              {enrichingIds[contact.id] ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Zap className="w-3.5 h-3.5" />
                              )}
                              {enrichingIds[contact.id]
                                ? 'Enriching...'
                                : contact.enrichedAt
                                ? 'Re-Enrich'
                                : 'Enrich'}
                            </button>

                            <button
                              onClick={() => handleOpenCallScript(contact)}
                              className="px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-xs font-medium inline-flex items-center gap-1 transition cursor-pointer"
                              title="Generate or view AI Cold Call Script"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                              {contact.callScript ? 'View Script' : 'Call Script'}
                            </button>

                            <button
                              onClick={() => handleOpenEmail(contact)}
                              className="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-medium inline-flex items-center gap-1 transition cursor-pointer"
                              title="Generate or view AI Outreach Email"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              {contact.emailSubject || contact.emailBody ? 'View Email' : 'Email'}
                            </button>

                            <button
                              onClick={() => {
                                setIsNewContact(false);
                                setEditingContact({ ...contact });
                              }}
                              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                              title="Edit Contact"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteContact(contact.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800"
                              title="Delete Contact"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                    })}

                    {displayedContacts.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-500 text-sm">
                          No contacts match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="p-4 rounded-2xl bg-indigo-500/10 text-indigo-400 mb-4">
              <Users className="w-10 h-10" />
            </div>
            <h2 className="text-xl font-bold text-white">No Lead List Selected</h2>
            <p className="text-sm text-slate-400 max-w-md mt-1 mb-6">
              Run an AI-grounded search with Google Search &amp; Vertex AI / Gemini to automatically discover 20 targeted business leads.
            </p>
            <button
              onClick={() => setShowNewSearch(true)}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" /> Start AI Lead Search
            </button>
          </div>
        )}
      </main>

      {showNewSearch && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreateSearchList}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" /> New AI Lead Search (20 Leads)
            </h3>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                List Name
              </label>
              <input
                type="text"
                placeholder="e.g., KC Plumbers"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Search Criteria (used with Google Search Grounding)
              </label>
              <textarea
                rows={3}
                placeholder="e.g., plumbers within 25 miles of the Kansas City area"
                value={newListCriteria}
                onChange={(e) => setNewListCriteria(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewSearch(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={searching}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-2"
              >
                {searching && <Loader2 className="w-4 h-4 animate-spin" />}
                {searching ? 'Searching Web...' : 'Run Search'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingContact && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleSaveContact}
            className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-lg font-bold text-white">
              {isNewContact ? 'Add Contact' : 'Edit Contact'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Business Name *</label>
                <input
                  type="text"
                  value={editingContact.businessName || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, businessName: e.target.value })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={editingContact.contactName || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, contactName: e.target.value })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Title</label>
                <input
                  type="text"
                  value={editingContact.contactTitle || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, contactTitle: e.target.value })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Phone</label>
                <input
                  type="text"
                  value={editingContact.phone || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, phone: e.target.value })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  value={editingContact.email || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, email: e.target.value })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Website</label>
                <input
                  type="text"
                  value={editingContact.website || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, website: e.target.value })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Address</label>
                <input
                  type="text"
                  value={editingContact.address || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, address: e.target.value })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={editingContact.notes || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, notes: e.target.value })
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingContact(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
              >
                Save Contact
              </button>
            </div>
          </form>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleSaveSettings}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" /> Gemini API Key Settings
            </h3>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Gemini API Key
              </label>
              <input
                type="password"
                placeholder="Paste your Gemini API Key"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
              >
                Save Key
              </button>
            </div>
          </form>
        </div>
      )}

      {scriptContact && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <PhoneCall className="w-5 h-5 text-indigo-400" />
                  Call Script — {scriptContact.businessName}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {scriptContact.contactName
                    ? `Contact: ${scriptContact.contactName} (${scriptContact.contactTitle || 'Decision Maker'})`
                    : 'Contact: Owner / Decision Maker'}{' '}
                  {scriptContact.phone ? `• Phone: ${scriptContact.phone}` : ''}
                </p>
              </div>
              <button
                onClick={() => setScriptContact(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
              >
                Close
              </button>
            </div>

            {generatingScript ? (
              <div className="py-16 flex flex-col items-center justify-center text-slate-300 gap-3">
                <Loader2 className="w-7 h-7 text-indigo-400 animate-spin" />
                <p className="text-sm font-medium">
                  Writing customized call script for {scriptContact.businessName}...
                </p>
              </div>
            ) : (
              <textarea
                rows={14}
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                className="w-full flex-1 p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm leading-relaxed font-sans focus:outline-none focus:border-indigo-500"
                placeholder="Call script will appear here..."
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={generatingScript}
                  onClick={handleRegenerateCallScript}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate with AI
                </button>
                <button
                  type="button"
                  disabled={generatingScript || !scriptText}
                  onClick={() => {
                    navigator.clipboard.writeText(scriptText);
                    setCopiedScript(true);
                    setTimeout(() => setCopiedScript(false), 2000);
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedScript ? 'Copied!' : 'Copy to Clipboard'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScriptContact(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={generatingScript}
                  onClick={handleSaveCallScript}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                >
                  Save Script
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {emailContact && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Mail className="w-5 h-5 text-sky-400" />
                  Outreach Email — {emailContact.businessName}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {emailContact.contactName
                    ? `Contact: ${emailContact.contactName} (${emailContact.contactTitle || 'Decision Maker'})`
                    : 'Contact: Owner / Decision Maker'}{' '}
                  {emailContact.email ? `• Email: ${emailContact.email}` : '• No email on file'}
                </p>
              </div>
              <button
                onClick={() => setEmailContact(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
              >
                Close
              </button>
            </div>

            {generatingEmail ? (
              <div className="py-16 flex flex-col items-center justify-center text-slate-300 gap-3">
                <Loader2 className="w-7 h-7 text-sky-400 animate-spin" />
                <p className="text-sm font-medium">
                  Writing personalized outreach email for {emailContact.businessName}...
                </p>
              </div>
            ) : (
              <div className="space-y-3 flex-1 flex flex-col overflow-y-auto">
                <div>
                  <label className="block text-xs text-slate-400 mb-1 font-medium">Subject</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Email subject line..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex-1 flex flex-col">
                  <label className="block text-xs text-slate-400 mb-1 font-medium">Body</label>
                  <textarea
                    rows={12}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    className="w-full flex-1 p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm leading-relaxed font-sans focus:outline-none focus:border-sky-500"
                    placeholder="Email body will appear here..."
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={generatingEmail}
                  onClick={handleRegenerateEmail}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate with AI
                </button>
                <button
                  type="button"
                  disabled={generatingEmail || (!emailSubject && !emailBody)}
                  onClick={() => {
                    navigator.clipboard.writeText(`Subject: ${emailSubject}\n\n${emailBody}`);
                    setCopiedEmail(true);
                    setTimeout(() => setCopiedEmail(false), 2000);
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedEmail ? 'Copied!' : 'Copy to Clipboard'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEmailContact(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium"
                >
                  Cancel
                </button>
                <a
                  href={`mailto:${emailContact.email || ''}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send Email
                </a>
                <button
                  type="button"
                  disabled={generatingEmail}
                  onClick={handleSaveEmail}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
                >
                  Save Email
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
