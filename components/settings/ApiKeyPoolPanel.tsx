import React, { useState, useEffect } from 'react';
import { KeyRound, ShieldCheck, RefreshCw, Plus, Trash2, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';
import { KeyPoolManager } from '../../services/llm/keyPool';
import { QuotaTracker } from '../../services/llm/quotaTracker';
import { AIProvider } from '../../types/ai';
import { useSettingsStore } from '../../store/settingsStore';
import { useToast } from '../shared/ToastProvider';

interface KeyInputState {
  id: string;
  value: string;
  isMasked: boolean;
  status: 'idle' | 'testing' | 'valid' | 'invalid';
  error?: string;
}

const PROVIDERS_CONFIG = [
  { id: 'gemini' as AIProvider, name: 'Google Gemini', defaultQuotaPerKey: 520, limitDesc: '500 Flash-Lite + 20 Flash/day per key' },
  { id: 'groq' as AIProvider, name: 'Groq', defaultQuotaPerKey: 1000, limitDesc: '1,000 Llama 4 Scout/day per key' },
  { id: 'openrouter' as AIProvider, name: 'OpenRouter', defaultQuotaPerKey: 200, limitDesc: 'General free models quota' },
  { id: 'cerebras' as AIProvider, name: 'Cerebras', defaultQuotaPerKey: 14400, limitDesc: '14,400 GPT-OSS-120B/day per key' },
  { id: 'cohere' as AIProvider, name: 'Cohere', defaultQuotaPerKey: 500, limitDesc: '500 Command A/day per key' }
];

export const ApiKeyPoolPanel: React.FC = () => {
  const settings = useSettingsStore();
  const updateSetting = settings.updateSetting;
  const { toast } = useToast();
  const [activeProvider, setActiveProvider] = useState<AIProvider>('gemini');
  const [keysByProvider, setKeysByProvider] = useState<Record<AIProvider, KeyInputState[]>>({
    omniroute: [],
    gemini: [],
    groq: [],
    openrouter: [],
    mistral: [],
    cerebras: [],
    github: [],
    cloudflare: [],
    cohere: []
  });
  
  const [stats, setStats] = useState<any>(null);
  const [utilizationSummary, setUtilizationSummary] = useState<any[]>([]);

  // Hydrate keys from KeyPoolManager and settings store
  useEffect(() => {
    const keyPool = KeyPoolManager.getInstance();
    const newKeysState: any = {};

    PROVIDERS_CONFIG.forEach(provider => {
      // Fetch keys from KeyPoolManager (primary) or settings store (secondary)
      let savedKeys = keyPool.getKeys(provider.id);
      if (savedKeys.length === 0) {
        // Fallback to array keys in settings store
        const storeKeys = (settings as any)[`${provider.id}ApiKeys` as any];
        if (Array.isArray(storeKeys) && storeKeys.length > 0) {
          savedKeys = storeKeys;
        } else {
          // Fallback to legacy single key
          const singleKey = (settings as any)[`${provider.id}ApiKey` as any] || (settings as any)[provider.id === 'openrouter' ? 'openRouterApiKey' : ''];
          if (singleKey) {
            savedKeys = [singleKey];
          }
        }
      }

      newKeysState[provider.id] = savedKeys.map((k, idx) => ({
        id: `${provider.id}-${idx}-${Date.now()}`,
        value: k,
        isMasked: true,
        status: 'idle' as const
      }));
    });

    setKeysByProvider(prev => ({ ...prev, ...newKeysState }));
    refreshStats();
  }, [settings]);

  const refreshStats = () => {
    setStats(KeyPoolManager.getInstance().getCallStats());
    setUtilizationSummary(QuotaTracker.getInstance().getUtilizationSummary());
  };

  const handleAddKey = (provider: AIProvider) => {
    const currentKeys = keysByProvider[provider];
    if (currentKeys.length >= 10) {
      toast.error('Maximum of 10 keys allowed per provider.');
      return;
    }
    const newKey: KeyInputState = {
      id: `${provider}-${currentKeys.length}-${Date.now()}`,
      value: '',
      isMasked: false,
      status: 'idle'
    };
    setKeysByProvider({
      ...keysByProvider,
      [provider]: [...currentKeys, newKey]
    });
  };

  const handleRemoveKey = (provider: AIProvider, id: string) => {
    setKeysByProvider({
      ...keysByProvider,
      [provider]: keysByProvider[provider].filter(k => k.id !== id)
    });
  };

  const handleKeyChange = (provider: AIProvider, id: string, value: string) => {
    setKeysByProvider({
      ...keysByProvider,
      [provider]: keysByProvider[provider].map(k => k.id === id ? { ...k, value, status: 'idle' } : k)
    });
  };

  const toggleMask = (provider: AIProvider, id: string) => {
    setKeysByProvider({
      ...keysByProvider,
      [provider]: keysByProvider[provider].map(k => k.id === id ? { ...k, isMasked: !k.isMasked } : k)
    });
  };

  const handleTestKey = async (provider: AIProvider, keyState: KeyInputState) => {
    const key = keyState.value.trim();
    if (!key) {
      toast.error('API key is empty.');
      return;
    }

    setKeysByProvider(prev => ({
      ...prev,
      [provider]: prev[provider].map(k => k.id === keyState.id ? { ...k, status: 'testing' } : k)
    }));

    let isValid = false;
    let errorMsg = 'Verification failed';

    try {
      if (provider === 'gemini') {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-latest:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] })
        });
        if (res.ok) {
          isValid = true;
        } else {
          const errText = await res.text();
          errorMsg = `Gemini: ${res.status} - ${errText.slice(0, 100)}`;
        }
      } else if (provider === 'groq') {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1
          })
        });
        if (res.ok) {
          isValid = true;
        } else {
          const errText = await res.text();
          errorMsg = `Groq: ${res.status} - ${errText.slice(0, 100)}`;
        }
      } else if (provider === 'openrouter') {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'google/gemma-3-4b:free',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1
          })
        });
        if (res.ok) {
          isValid = true;
        } else {
          const errText = await res.text();
          errorMsg = `OpenRouter: ${res.status} - ${errText.slice(0, 100)}`;
        }
      } else if (provider === 'cerebras') {
        const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'llama-3.1-8b',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1
          })
        });
        if (res.ok) {
          isValid = true;
        } else {
          const errText = await res.text();
          errorMsg = `Cerebras: ${res.status} - ${errText.slice(0, 100)}`;
        }
      } else if (provider === 'cohere') {
        const res = await fetch('https://api.cohere.com/v2/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'command-r-plus',
            messages: [{ role: 'user', content: 'ping' }]
          })
        });
        if (res.ok) {
          isValid = true;
        } else {
          const errText = await res.text();
          errorMsg = `Cohere: ${res.status} - ${errText.slice(0, 100)}`;
        }
      }
    } catch (e: any) {
      errorMsg = e.message || String(e);
    }

    setKeysByProvider(prev => ({
      ...prev,
      [provider]: prev[provider].map(k => k.id === keyState.id ? {
        ...k,
        status: isValid ? 'valid' : 'invalid',
        error: isValid ? undefined : errorMsg
      } : k)
    }));

    if (isValid) {
      toast.success('API Key verified successfully!');
    } else {
      toast.error(`Key Verification Failed: ${errorMsg}`);
    }
  };

  const handleSaveKeys = () => {
    const keyPool = KeyPoolManager.getInstance();
    let hasKeys = false;

    PROVIDERS_CONFIG.forEach(provider => {
      const cleanKeys = keysByProvider[provider.id]
        .map(k => k.value.trim())
        .filter(Boolean);

      // Save to KeyPoolManager (which secures them internally)
      keyPool.setKeys(provider.id, cleanKeys);

      // Save arrays to Settings Store
      updateSetting(`${provider.id}ApiKeys` as any, cleanKeys);

      // Also set the primary key setting if available for backwards compatibility
      if (cleanKeys.length > 0) {
        hasKeys = true;
        if (provider.id === 'gemini') {
          updateSetting('geminiApiKey', cleanKeys[0]);
        } else if (provider.id === 'groq') {
          updateSetting('groqApiKey', cleanKeys[0]);
        } else if (provider.id === 'openrouter') {
          updateSetting('openRouterApiKey', cleanKeys[0]);
        } else if (provider.id === 'cerebras') {
          updateSetting('cerebrasApiKey', cleanKeys[0]);
        } else if (provider.id === 'cohere') {
          updateSetting('cohereApiKey', cleanKeys[0]);
        }
      } else {
        if (provider.id === 'gemini') updateSetting('geminiApiKey', '');
        else if (provider.id === 'groq') updateSetting('groqApiKey', '');
        else if (provider.id === 'openrouter') updateSetting('openRouterApiKey', '');
        else if (provider.id === 'cerebras') updateSetting('cerebrasApiKey', '');
        else if (provider.id === 'cohere') updateSetting('cohereApiKey', '');
      }
    });

    toast.success('API Key Pool saved and secured.');
    refreshStats();
  };

  const getEstimatedCapacity = (providerId: AIProvider) => {
    const config = PROVIDERS_CONFIG.find(c => c.id === providerId);
    if (!config) return 0;
    const activeKeysCount = keysByProvider[providerId].filter(k => k.value.trim().length > 0).length;
    return activeKeysCount * config.defaultQuotaPerKey;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound size={20} className="text-indigo-500" />
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">API Key Pool Management</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure multiple keys for high-volume round-robin rotation and failover.
            </p>
          </div>
        </div>
        <button
          onClick={handleSaveKeys}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20"
        >
          Save & Secure Pool
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        {/* Sidebar Nav */}
        <div className="md:col-span-1 space-y-1 bg-slate-50/50 dark:bg-slate-900/40 p-2 rounded-3xl border border-slate-200/50 dark:border-slate-800/50">
          {PROVIDERS_CONFIG.map(p => {
            const activeKeysCount = keysByProvider[p.id]?.filter(k => k.value.trim().length > 0).length || 0;
            return (
              <button
                key={p.id}
                onClick={() => setActiveProvider(p.id)}
                className={`w-full text-left px-4 py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-between ${
                  activeProvider === p.id
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/15'
                    : 'text-slate-600 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:bg-slate-800/40'
                }`}
              >
                <span>{p.name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                  activeProvider === p.id ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}>
                  {activeKeysCount} keys
                </span>
              </button>
            );
          })}
        </div>

        {/* Key List & Editor */}
        <div className="md:col-span-3 space-y-4 rounded-3xl border border-slate-200/80 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {PROVIDERS_CONFIG.find(p => p.id === activeProvider)?.name} Keys
              </h4>
              <p className="text-[11px] text-slate-500">
                {PROVIDERS_CONFIG.find(p => p.id === activeProvider)?.limitDesc}
              </p>
            </div>
            <button
              onClick={() => handleAddKey(activeProvider)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-400 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold transition-all"
            >
              <Plus size={14} /> Add Key
            </button>
          </div>

          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {keysByProvider[activeProvider]?.map((keyState, index) => (
              <div
                key={keyState.id}
                className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-200/50 dark:border-slate-800/50"
              >
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 w-8 text-center">
                  #{index + 1}
                </span>

                <div className="relative flex-1">
                  <input
                    type={keyState.isMasked ? 'password' : 'text'}
                    value={keyState.value}
                    onChange={(e) => handleKeyChange(activeProvider, keyState.id, e.target.value)}
                    className="w-full bg-transparent px-3 py-2 pr-10 text-xs font-mono text-slate-900 focus:outline-none dark:text-white"
                    placeholder={`Enter ${PROVIDERS_CONFIG.find(p => p.id === activeProvider)?.name} API Key`}
                  />
                  <button
                    onClick={() => toggleMask(activeProvider, keyState.id)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {keyState.isMasked ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>

                {/* Validation Status Indicator */}
                <div className="flex items-center">
                  {keyState.status === 'testing' && (
                    <RefreshCw size={14} className="animate-spin text-indigo-500" />
                  )}
                  {keyState.status === 'valid' && (
                    <span title="Key works">
                      <CheckCircle2 size={16} className="text-emerald-500" />
                    </span>
                  )}
                  {keyState.status === 'invalid' && (
                    <span title={keyState.error || 'Verification failed'}>
                      <XCircle size={16} className="text-rose-500" />
                    </span>
                  )}
                </div>

                <button
                  onClick={() => handleTestKey(activeProvider, keyState)}
                  className="px-2.5 py-1.5 bg-slate-200/60 dark:bg-slate-800/80 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 text-slate-600 dark:text-slate-300 text-[10px] font-bold rounded-xl transition-all"
                  disabled={keyState.status === 'testing'}
                >
                  Test
                </button>

                <button
                  onClick={() => handleRemoveKey(activeProvider, keyState.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            {keysByProvider[activeProvider]?.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                No keys added yet. Click &quot;Add Key&quot; above to start.
              </div>
            )}
          </div>

          {/* Quick Metrics */}
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-4">
            <div className="p-3 bg-slate-50/50 dark:bg-slate-950/30 rounded-2xl border border-slate-200/30 dark:border-slate-800/30">
              <span className="text-[10px] font-bold uppercase text-slate-400">Total Keys</span>
              <p className="text-lg font-bold text-slate-800 dark:text-white">
                {keysByProvider[activeProvider]?.filter(k => k.value.trim().length > 0).length || 0}
              </p>
            </div>
            <div className="p-3 bg-slate-50/50 dark:bg-slate-950/30 rounded-2xl border border-slate-200/30 dark:border-slate-800/30">
              <span className="text-[10px] font-bold uppercase text-slate-400">Est. Capacity</span>
              <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                {getEstimatedCapacity(activeProvider).toLocaleString()} calls / day
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Utilization and Health Dashboard */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/50 space-y-4">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
          <ShieldCheck size={16} className="text-emerald-500" />
          Key Pool Health & Utilization
        </h4>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {utilizationSummary.map(model => {
            const limit = model.dailyLimit;
            const calls = model.callsToday;
            const pct = limit === Infinity ? 0 : Math.min(100, Math.round((calls / limit) * 100));

            return (
              <div key={model.modelId} className="p-4 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                      {model.modelId}
                    </h5>
                    <span className="text-[9px] font-mono uppercase bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 px-1.5 py-0.5 rounded">
                      {model.provider}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                    {calls} / {limit === Infinity ? '∞' : limit}
                  </span>
                </div>

                <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      pct > 80 ? 'bg-rose-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${limit === Infinity ? 0 : pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
