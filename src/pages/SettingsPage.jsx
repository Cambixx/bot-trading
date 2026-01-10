import { useSettings } from '../context/SettingsContext';
import { Bell, BellOff, Shield, Zap, DollarSign, Crosshair } from 'lucide-react';

function SettingsPage() {
    const {
        tradingMode,
        setTradingMode,
        riskPerTrade,
        setRiskPerTrade,
        notificationsEnabled,
        toggleNotifications
    } = useSettings();

    return (
        <div className="settings-page fade-in">
            <h2 className="mb-xl">Ajustes de Estrategia</h2>

            <div className="settings-grid" style={{ display: 'grid', gap: '1.5rem', maxWidth: '800px' }}>

                {/* Trading Mode */}
                <div className="glass-card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                        <Zap className="text-primary" size={24} />
                        <h3 style={{ margin: 0 }}>Modo de Trading</h3>
                    </div>
                    <p className="text-muted mb-md">Define la agresividad de las señales generadas.</p>

                    <div className="mode-options" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        {['CONSERVATIVE', 'BALANCED', 'SNIPER', 'RISKY', 'SCALPING'].map(mode => (
                            <button
                                key={mode}
                                onClick={() => setTradingMode(mode)}
                                className={`btn-${tradingMode === mode ? 'primary' : 'secondary'}`}
                                style={{ flex: 1, minWidth: '120px' }}
                            >
                                {mode === 'CONSERVATIVE' && '🛡️ Conservador'}
                                {mode === 'BALANCED' && '⚖️ Equilibrado'}
                                {mode === 'SNIPER' && '🎯 Sniper'}
                                {mode === 'RISKY' && '🚀 Arriesgado'}
                                {mode === 'SCALPING' && '⚡ Scalping'}
                            </button>
                        ))}
                    </div>
                    <div className="mt-md p-md" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                        <small className="text-muted">
                            {tradingMode === 'CONSERVATIVE' && 'Solo opera a favor de la tendencia mayor. Menos señales, mayor tasa de acierto.'}
                            {tradingMode === 'BALANCED' && 'Equilibrio entre tendencia y momentum. Estrategia estándar.'}
                            {tradingMode === 'SNIPER' && '🎯 Precisión extrema: 1-4 trades/día. Requiere ADX>25, Choppiness<50, RVOL>1.2 y confluencia en S/R o SMC. Score mínimo 70.'}
                            {tradingMode === 'RISKY' && 'Busca reversiones y scalps rápidos. Más señales, mayor riesgo.'}
                            {tradingMode === 'SCALPING' && 'Modo day trading: stops ajustados, alta frecuencia (~4-5 operaciones/día por par).'}
                        </small>
                    </div>
                </div>

                {/* Risk Management */}
                <div className="glass-card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                        <Shield className="text-success" size={24} />
                        <h3 style={{ margin: 0 }}>Gestión de Riesgo</h3>
                    </div>

                    <div className="form-group">
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                            <DollarSign size={14} style={{ display: 'inline', marginRight: '4px' }} />
                            Monto por Operación (Simulado)
                        </label>
                        <input
                            type="number"
                            value={riskPerTrade}
                            onChange={(e) => setRiskPerTrade(Number(e.target.value))}
                            className="input-field"
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: '8px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: 'white'
                            }}
                        />
                    </div>
                </div>

                {/* Notifications */}
                <div className="glass-card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            {notificationsEnabled ? <Bell className="text-warning" size={24} /> : <BellOff className="text-muted" size={24} />}
                            <div>
                                <h3 style={{ margin: 0 }}>Notificaciones</h3>
                                <p className="text-muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                                    {notificationsEnabled ? 'Activadas' : 'Desactivadas'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={toggleNotifications}
                            className={`btn-${notificationsEnabled ? 'secondary' : 'primary'}`}
                        >
                            {notificationsEnabled ? 'Desactivar' : 'Activar'}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default SettingsPage;
