import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Smartphone, Laptop, Tablet, Monitor, Shield, Trash2, Edit2, Check, X, RefreshCw, Radio } from 'lucide-react';
import { deviceSessionManager, DeviceSession } from '../../services/DeviceSessionManager';

interface DeviceManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeviceManagementModal: React.FC<DeviceManagementModalProps> = ({ isOpen, onClose }) => {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const currentMetadata = deviceSessionManager.getMetadata();

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const data = await deviceSessionManager.fetchActiveSessions();
      setSessions(data);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleRevoke = async (deviceId: string) => {
    if (!window.confirm('Are you sure you want to log out this device remotely? It will immediately lose access and clear local session state.')) {
      return;
    }
    setRevokingId(deviceId);
    try {
      const ok = await deviceSessionManager.revokeRemoteDevice(deviceId);
      if (ok) {
        setSessions(prev => prev.filter(s => s.device_id !== deviceId));
      }
    } finally {
      setRevokingId(null);
    }
  };

  const handleSaveNickname = (deviceId: string) => {
    if (deviceId === currentMetadata.deviceId && nicknameInput.trim()) {
      deviceSessionManager.setCustomNickname(nicknameInput.trim());
    }
    setEditingDeviceId(null);
    loadSessions();
  };

  const renderDeviceIcon = (type: string) => {
    switch (type) {
      case 'mobile':
        return <Smartphone className="w-5 h-5 text-semantic-accent" />;
      case 'tablet':
        return <Tablet className="w-5 h-5 text-semantic-accent" />;
      default:
        return <Laptop className="w-5 h-5 text-semantic-accent" />;
    }
  };

  const formatLastActive = (timestamp: number) => {
    const elapsed = Date.now() - timestamp;
    if (elapsed < 60000) return 'Just now';
    if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`;
    if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-tf-bg-app/80 backdrop-blur-md transition-opacity" 
        onClick={onClose} 
      />

      {/* Dialog Surface */}
      <div className="relative w-full max-w-xl bg-tf-bg-surface border border-tf-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-tf-border bg-tf-bg-elevated/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-tf-bg-card rounded-xl border border-tf-border">
              <Shield className="w-5 h-5 text-semantic-accent" />
            </div>
            <div>
              <h2 className="text-base font-bold text-tf-text-primary">Connected Devices & Sessions</h2>
              <p className="text-xs text-tf-text-secondary">Google & Telegram-style multi-device consciousness</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadSessions}
              disabled={isLoading}
              className="p-2 text-tf-text-secondary hover:text-tf-text-primary hover:bg-tf-bg-card rounded-lg transition-colors border border-transparent hover:border-tf-border"
              title="Refresh device list"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-tf-text-secondary hover:text-tf-text-primary hover:bg-tf-bg-card rounded-lg transition-colors border border-transparent hover:border-tf-border"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Current Device Banner */}
        <div className="px-5 py-3.5 bg-tf-bg-card border-b border-tf-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-semantic-accent-muted rounded-lg">
              {renderDeviceIcon(currentMetadata.deviceType)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-tf-text-primary">
                  {currentMetadata.deviceName}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-semantic-gain-muted text-semantic-gain border border-semantic-gain/20">
                  This Device
                </span>
              </div>
              <p className="text-[11px] text-tf-text-muted mt-0.5">
                {currentMetadata.browser} · {currentMetadata.os}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setEditingDeviceId(currentMetadata.deviceId);
              setNicknameInput(currentMetadata.deviceName);
            }}
            className="p-1.5 text-tf-text-secondary hover:text-tf-text-primary hover:bg-tf-bg-elevated rounded-lg transition-colors text-xs font-medium flex items-center gap-1.5"
            title="Edit device name"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Rename</span>
          </button>
        </div>

        {/* Nickname Editor Drawer */}
        {editingDeviceId === currentMetadata.deviceId && (
          <div className="px-5 py-3 bg-tf-bg-elevated/60 border-b border-tf-border flex items-center gap-2">
            <input
              type="text"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              placeholder="e.g. My College Phone, Office Laptop..."
              className="flex-1 bg-tf-bg-card border border-tf-border rounded-lg px-3 py-1.5 text-xs text-tf-text-primary focus:outline-none focus:border-semantic-accent"
              autoFocus
            />
            <button
              onClick={() => handleSaveNickname(currentMetadata.deviceId)}
              className="px-3 py-1.5 bg-semantic-accent hover:opacity-90 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button
              onClick={() => setEditingDeviceId(null)}
              className="px-2.5 py-1.5 text-tf-text-secondary hover:bg-tf-bg-card rounded-lg text-xs"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Sessions List */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1 custom-scrollbar">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-tf-text-muted mb-2">
            Active Hardware Sessions ({sessions.length})
          </div>

          {sessions.length === 0 && !isLoading && (
            <div className="text-center py-8 text-tf-text-muted text-xs">
              No remote sessions found. Heartbeat is registering this device...
            </div>
          )}

          {sessions.map((session) => {
            const isThisDevice = session.device_id === currentMetadata.deviceId;
            return (
              <div
                key={session.device_id}
                className={`p-4 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                  isThisDevice
                    ? 'bg-tf-bg-card/70 border-semantic-accent/40 shadow-sm'
                    : 'bg-tf-bg-card/40 border-tf-border hover:border-tf-border-subtle'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="p-2.5 bg-tf-bg-elevated rounded-xl border border-tf-border">
                    {renderDeviceIcon(session.device_type)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-tf-text-primary truncate">
                        {session.device_name}
                      </span>
                      {session.is_online ? (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-semantic-gain">
                          <span className="w-1.5 h-1.5 rounded-full bg-semantic-gain animate-pulse" />
                          Online
                        </span>
                      ) : (
                        <span className="text-[10px] text-tf-text-muted">
                          {formatLastActive(session.last_active_at)}
                        </span>
                      )}
                      {isThisDevice && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-semantic-accent-muted text-semantic-accent border border-semantic-accent/20">
                          Active Now
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-tf-text-secondary mt-1 flex-wrap">
                      <span>{session.browser}</span>
                      <span>·</span>
                      <span>{session.os}</span>
                      {session.ip_address && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-tf-text-muted">{session.ip_address}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {!isThisDevice && (
                  <button
                    onClick={() => handleRevoke(session.device_id)}
                    disabled={revokingId === session.device_id}
                    className="p-2 text-semantic-loss hover:bg-semantic-loss-muted rounded-xl transition-colors border border-transparent hover:border-semantic-loss/20 flex-shrink-0"
                    title="Log out this device remotely"
                  >
                    <Trash2 className={`w-4 h-4 ${revokingId === session.device_id ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer Note */}
        <div className="p-4 border-t border-tf-border bg-tf-bg-elevated/20 text-center">
          <p className="text-[11px] text-tf-text-muted">
            Revoking a session immediately cancels all sync pipelines and logs that hardware out of WealthOS.
          </p>
        </div>

      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
