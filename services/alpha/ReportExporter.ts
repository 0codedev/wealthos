import { MarketRegime } from './SignalFusionService';
import { OptionChainSnapshot } from '../OptionChainService';
import { StockConviction } from './SignalFusionService';
import { escapeHtml } from '../../utils/security';

class ReportExporter {
  private static instance: ReportExporter;

  private constructor() {}

  static getInstance(): ReportExporter {
    if (!ReportExporter.instance) {
      ReportExporter.instance = new ReportExporter();
    }
    return ReportExporter.instance;
  }

  private printHTML(title: string, htmlContent: string) {
    if (typeof window === 'undefined') return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${escapeHtml(title)}</title>
          <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
          <style>
            body { 
              font-family: 'Plus Jakarta Sans', system-ui, sans-serif; 
              background: #ffffff; 
              color: #0f172a; 
              padding: 40px; 
              line-height: 1.5; 
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 16px;
              margin-bottom: 24px;
            }
            .logo {
              font-size: 20px;
              font-weight: 800;
              color: #0f172a;
              letter-spacing: -0.05em;
            }
            .logo span {
              color: #4f46e5;
            }
            .timestamp {
              font-size: 11px;
              color: #64748b;
              font-weight: 600;
            }
            h1 { 
              font-size: 22px; 
              font-weight: 800; 
              margin: 0 0 4px 0; 
              color: #0f172a; 
            }
            .subtitle {
              font-size: 12px;
              color: #64748b;
              margin: 0;
              font-weight: 500;
            }
            .grid { 
              display: grid; 
              grid-template-columns: 1fr 1fr; 
              gap: 20px; 
              margin-bottom: 24px;
            }
            .card { 
              border: 1px solid #f1f5f9; 
              background: #f8fafc;
              padding: 20px; 
              border-radius: 16px; 
            }
            .card-title {
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: #64748b;
              margin: 0 0 12px 0;
            }
            .regime-badge {
              display: inline-block;
              padding: 4px 10px;
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
              border-radius: 6px;
            }
            .badge-green { background: #d1fae5; color: #065f46; }
            .badge-red { background: #fee2e2; color: #991b1b; }
            .badge-blue { background: #dbeafe; color: #1e40af; }
            .badge-yellow { background: #fef3c7; color: #92400e; }
            .badge-sky { background: #e0f2fe; color: #0369a1; }
            
            .metric-row {
              display: flex;
              justify-content: space-between;
              padding: 8px 0;
              border-bottom: 1px dashed #e2e8f0;
              font-size: 12px;
            }
            .metric-row:last-child {
              border: none;
            }
            .metric-label {
              font-weight: 600;
              color: #475569;
            }
            .metric-val {
              font-weight: 700;
              color: #0f172a;
              font-family: monospace;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-top: 10px; 
            }
            th { 
              text-align: left; 
              font-size: 10px; 
              font-weight: 800;
              text-transform: uppercase; 
              color: #64748b; 
              border-bottom: 1px solid #e2e8f0; 
              padding: 8px 4px; 
            }
            td { 
              font-size: 12px; 
              padding: 8px 4px; 
              border-bottom: 1px solid #f1f5f9; 
            }
            .recommendation-list {
              padding-left: 18px;
              margin: 0;
              font-size: 12px;
              color: #334155;
            }
            .recommendation-list li {
              margin-bottom: 6px;
            }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          ${htmlContent}
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 750);
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  exportDailyReport(
    regime: MarketRegime,
    pcr: number,
    fiiHistory: any[],
    convictionList: StockConviction[]
  ) {
    const regimeColors: Record<string, string> = {
      'TRENDING UP': 'badge-green',
      'TRENDING DOWN': 'badge-red',
      'RANGE-BOUND': 'badge-blue',
      'DISTRIBUTION': 'badge-yellow',
      'ACCUMULATION': 'badge-sky',
    };

    const regimeClass = regimeColors[regime.label] || 'badge-blue';
    const fiiNetText = regime.fiiNetFlow >= 0 ? `+₹${regime.fiiNetFlow.toFixed(1)} Cr` : `-₹${Math.abs(regime.fiiNetFlow).toFixed(1)} Cr`;
    const fiiClass = regime.fiiNetFlow >= 0 ? 'color: #065f46; font-weight: bold;' : 'color: #b91c1c; font-weight: bold;';

    const stocksHtml = convictionList.slice(0, 8).map((s, idx) => `
      <tr>
        <td>#${idx + 1}</td>
        <td style="font-weight: 700;">${escapeHtml(s.symbol)}</td>
        <td style="font-family: monospace; font-weight: bold;">${s.convictionScore}</td>
        <td><span class="regime-badge ${s.oiQuadrant === 'LONG BUILDUP' ? 'badge-green' : s.oiQuadrant === 'SHORT BUILDUP' ? 'badge-red' : 'badge-blue'}">${s.oiQuadrant}</span></td>
        <td>${s.gFactor.toFixed(1)}</td>
        <td>${s.fundamentalScore}/100</td>
      </tr>
    `).join('');

    const html = `
      <div class="header">
        <div>
          <div class="logo">ANTIGRAVITY<span>PRO</span></div>
          <div class="subtitle">AI Signal Fusion Market Intelligence</div>
        </div>
        <div class="timestamp">Generated: ${new Date().toLocaleString()}</div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <h1>Daily Pulse Briefing</h1>
        <p class="subtitle">Executive compilation of multi-source institutional signal derivatives</p>
      </div>

      <div class="grid">
        <div class="card">
          <h4 class="card-title">Market Regime Assessment</h4>
          <div style="margin-bottom: 12px;">
            <span class="regime-badge ${regimeClass}">${regime.label}</span>
          </div>
          <p style="font-size: 12px; color: #475569; margin: 0 0 16px 0; font-weight: 500;">
            ${regime.description}
          </p>
          <h5 style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; margin: 0 0 8px 0;">Tactical Directives</h5>
          <ul class="recommendation-list">
            ${regime.recommendations.map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>
        
        <div class="card">
          <h4 class="card-title">Macro Risk Metrics</h4>
          <div class="metric-row">
            <span class="metric-label">India VIX (Fear Gauge)</span>
            <span class="metric-val" style="${regime.vix > 18 ? 'color: #b91c1c;' : 'color: #0f172a;'}">${regime.vix.toFixed(2)}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Put-Call Ratio (PCR)</span>
            <span class="metric-val">${pcr.toFixed(2)}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">FII Cash Net Flow (CM)</span>
            <span class="metric-val" style="${fiiClass}">${fiiNetText}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Advance-Decline Ratio</span>
            <span class="metric-val">${regime.adr.toFixed(2)}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Sector Breadth Score</span>
            <span class="metric-val">${regime.sectorBreadth.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <div class="card" style="background: #ffffff; border: 1px solid #e2e8f0; margin-bottom: 24px;">
        <h4 class="card-title" style="margin-bottom: 16px;">Top High-Conviction Tactical Signals</h4>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Symbol</th>
              <th>Conviction</th>
              <th>OI Buildup</th>
              <th>G-Factor</th>
              <th>Fundamentals</th>
            </tr>
          </thead>
          <tbody>
            ${stocksHtml}
          </tbody>
        </table>
      </div>

      <div style="font-size: 9px; color: #94a3b8; text-align: center; margin-top: 40px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        Disclaimer: This report is an AI-generated mathematical model synthesis of public derivatives indicators. For informational use only. SEBI registration: none.
      </div>
    `;

    this.printHTML('Antigravity_Daily_Briefing', html);
  }

  exportWeeklyFundamentals(
    portfolioScore: number,
    holdings: any[]
  ) {
    const listHtml = holdings.map((h, idx) => `
      <tr>
        <td>#${idx + 1}</td>
        <td style="font-weight: 700;">${escapeHtml(h.name)} (${escapeHtml(h.ticker)})</td>
        <td style="font-family: monospace; font-weight: bold;">₹${h.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
        <td>${h.portfolioWeight.toFixed(1)}%</td>
        <td style="font-family: monospace; font-weight: bold; color: ${h.fScore >= 70 ? '#059669' : h.fScore >= 50 ? '#d97706' : '#dc2626'};">${h.fScore}/100</td>
      </tr>
    `).join('');

    const html = `
      <div class="header">
        <div>
          <div class="logo">ANTIGRAVITY<span>PRO</span></div>
          <div class="subtitle">Portfolio Quality & Fundamental Auditor</div>
        </div>
        <div class="timestamp">Audited: ${new Date().toLocaleString()}</div>
      </div>
      
      <div style="margin-bottom: 24px;">
        <h1>Weekly Fundamentals Audit</h1>
        <p class="subtitle">Structural review of equity asset balance sheets, earnings growth, and ownership flows</p>
      </div>

      <div class="grid">
        <div class="card" style="display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center;">
          <h4 class="card-title">Portfolio Quality Rating</h4>
          <div style="font-size: 48px; font-weight: 800; color: #4f46e5; margin: 10px 0; line-height: 1;">
            ${portfolioScore.toFixed(0)}<span style="font-size: 20px; color: #94a3b8;">/100</span>
          </div>
          <span class="regime-badge ${portfolioScore >= 75 ? 'badge-green' : portfolioScore >= 55 ? 'badge-yellow' : 'badge-red'}">
            ${portfolioScore >= 75 ? 'Institutional Grade' : portfolioScore >= 55 ? 'Moderate Quality' : 'Speculative Grade'}
          </span>
        </div>
        
        <div class="card">
          <h4 class="card-title">Auditor Insight</h4>
          <p style="font-size: 12px; color: #334155; margin: 0; leading-relaxed: 1.6;">
            ${portfolioScore >= 75 
              ? 'Your equity holdings show strong revenue growth trajectories, ROE > 15%, and conservative debt-to-equity leverage (< 0.5x). Institutional holdings (FIIs/DIIs) are stable or increasing.' 
              : portfolioScore >= 55
              ? 'Moderate balance sheet coverage. Some holdings exhibit high debt ratios or declining operating profit margins. Recommend reviewing allocations in positions with fundamental scores below 50.'
              : 'Alert: Heavy concentration in fundamentally speculative assets. Balance sheets show high leverage (D/E > 1.2x) or negative quarterly promoter/FII accumulation streams. Portfolio hedging is recommended.'}
          </p>
        </div>
      </div>

      <div class="card" style="background: #ffffff; border: 1px solid #e2e8f0;">
        <h4 class="card-title" style="margin-bottom: 16px;">Holdings Audit Details</h4>
        <table>
          <thead>
            <tr>
              <th>Index</th>
              <th>Asset Name</th>
              <th>Current Value</th>
              <th>Weight</th>
              <th>Fundamental Score</th>
            </tr>
          </thead>
          <tbody>
            ${listHtml}
          </tbody>
        </table>
      </div>
    `;

    this.printHTML('Antigravity_Weekly_Audit', html);
  }

  shareSetup(
    regime: MarketRegime,
    maxPain: number,
    support: number,
    resistance: number,
    compassScore: number
  ) {
    const compassLabel = compassScore >= 60 ? 'Strong Bullish' : compassScore >= 15 ? 'Bullish' : compassScore <= -60 ? 'Strong Bearish' : compassScore <= -15 ? 'Bearish' : 'Neutral';
    const compassColor = compassScore >= 15 ? '#10b981' : compassScore <= -15 ? '#f43f5e' : '#64748b';

    const html = `
      <div style="display: flex; justify-content: center; align-items: center; height: 100vh; background: #0f172a; margin: 0; padding: 20px; box-sizing: border-box;">
        <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 28px; width: 560px; padding: 36px; color: #ffffff; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
          
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 20px; margin-bottom: 28px;">
            <div>
              <div style="font-size: 14px; font-weight: 800; color: #6366f1; letter-spacing: 0.1em; text-transform: uppercase;">Antigravity Alpha</div>
              <div style="font-size: 22px; font-weight: 800; margin-top: 4px; letter-spacing: -0.02em;">Today's Market Setup</div>
            </div>
            <div style="font-size: 11px; color: #94a3b8; font-weight: 600; font-family: monospace;">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px;">
            <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 20px; padding: 20px;">
              <div style="font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Market Regime</div>
              <div style="font-size: 20px; font-weight: 800; color: #38bdf8; letter-spacing: -0.01em;">${escapeHtml(regime.label)}</div>
              <div style="font-size: 11px; color: #cbd5e1; margin-top: 6px; line-height: 1.4;">${escapeHtml(regime.description)}</div>
            </div>
            
            <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 20px; padding: 20px; display: flex; flex-direction: column; justify-content: center;">
              <div style="font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Smart Money Compass</div>
              <div style="font-size: 32px; font-weight: 900; color: ${compassColor}; line-height: 1;">
                ${compassScore > 0 ? '+' : ''}${compassScore}
              </div>
              <div style="font-size: 11px; font-weight: 700; color: #cbd5e1; margin-top: 4px;">Institutional Bias: ${compassLabel}</div>
            </div>
          </div>
          
          <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255,255,255,0.05); border-radius: 20px; padding: 24px; display: flex; flex-direction: column; gap: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 10px;">
              <span style="font-size: 12px; color: #94a3b8; font-weight: 600;">NIFTY Max Pain Strike</span>
              <span style="font-size: 14px; font-weight: 800; color: #fef08a; font-family: monospace;">₹${maxPain.toLocaleString('en-IN')}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 10px;">
              <span style="font-size: 12px; color: #94a3b8; font-weight: 600;">Key OI Support Floor</span>
              <span style="font-size: 14px; font-weight: 800; color: #34d399; font-family: monospace;">₹${support.toLocaleString('en-IN')}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 12px; color: #94a3b8; font-weight: 600;">Key OI Resistance Ceiling</span>
              <span style="font-size: 14px; font-weight: 800; color: #f87171; font-family: monospace;">₹${resistance.toLocaleString('en-IN')}</span>
            </div>
          </div>
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 28px; font-size: 10px; color: #64748b; font-weight: 600;">
            <div>Synthesized using Upstox Pro Plus Feeds</div>
            <button onclick="window.print();" style="background: #6366f1; border: none; color: #ffffff; font-weight: 800; text-transform: uppercase; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 9px; letter-spacing: 0.05em; transition: all 0.2s;">Print Card</button>
          </div>
          
        </div>
      </div>
    `;

    this.printHTML('Antigravity_Today_Setup', html);
  }
}

export const reportExporter = ReportExporter.getInstance();
