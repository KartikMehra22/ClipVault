'use client';

import { useEffect, useState } from 'react';
import type { DesktopInfo } from '@cliporbit/contracts';

type BridgeStatus = 'connecting' | 'connected' | 'error';

export default function HomePage() {
  const [status, setStatus] = useState<BridgeStatus>('connecting');
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDesktopInfo() {
      // Guard against non-Electron or unattached preload environments
      if (typeof window === 'undefined' || !window.clipOrbit?.getDesktopInfo) {
        if (isMounted) {
          setStatus('error');
          setErrorMessage('Desktop bridge unavailable: preload not attached.');
        }
        return;
      }

      try {
        const info = await window.clipOrbit.getDesktopInfo();
        if (isMounted) {
          setDesktopInfo(info);
          setStatus('connected');
        }
      } catch (err) {
        if (isMounted) {
          setStatus('error');
          setErrorMessage(err instanceof Error ? err.message : 'Failed to retrieve desktop info.');
        }
      }
    }

    loadDesktopInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="container">
      <div className="card">
        <div className="badge">
          <span className="badge-dot" />
          <span>Desktop Shell</span>
        </div>
        <h1 className="title">ClipOrbit</h1>
        <p className="subtitle">Your clipboard workspace is getting ready.</p>

        <div className="status-box">
          <span
            className={`status-indicator ${
              status === 'connected'
                ? 'status-online'
                : status === 'error'
                  ? 'status-offline'
                  : 'status-pending'
            }`}
          />
          <span className="status-text">
            {status === 'connected' && 'Desktop application shell connected.'}
            {status === 'connecting' && 'Connecting to desktop bridge...'}
            {status === 'error' && (errorMessage || 'Bridge connection failed.')}
          </span>
        </div>

        {status === 'connected' && desktopInfo && (
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Bridge Status</span>
              <span className="info-value info-highlight">Connected</span>
            </div>
            <div className="info-item">
              <span className="info-label">Application</span>
              <span className="info-value">{desktopInfo.appName}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Version</span>
              <span className="info-value">{desktopInfo.appVersion}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Platform</span>
              <span className="info-value">{desktopInfo.platform}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
