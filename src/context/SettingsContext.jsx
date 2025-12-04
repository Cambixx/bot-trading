import { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
    // Trading Mode
    const [tradingMode, setTradingMode] = useState(() => {
        return localStorage.getItem('trading_mode') || 'BALANCED';
    });

    // Risk Management
    const [riskPerTrade, setRiskPerTrade] = useState(() => {
        return Number(localStorage.getItem('risk_per_trade')) || 1000;
    });

    // Notifications
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);

    // Watchlist
    const [watchlist, setWatchlist] = useState(() => {
        const saved = localStorage.getItem('watchlist');
        return saved ? JSON.parse(saved) : [];
    });

    // Persist settings
    useEffect(() => {
        localStorage.setItem('trading_mode', tradingMode);
    }, [tradingMode]);

    useEffect(() => {
        localStorage.setItem('risk_per_trade', riskPerTrade);
    }, [riskPerTrade]);

    useEffect(() => {
        localStorage.setItem('watchlist', JSON.stringify(watchlist));
    }, [watchlist]);

    // Request Notification Permission on mount
    useEffect(() => {
        try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                setNotificationsEnabled(true);
            }
        } catch (e) {
            console.warn('Notification API check failed', e);
        }
    }, []);

    const toggleNotifications = async () => {
        try {
            if (!notificationsEnabled && typeof Notification !== 'undefined') {
                const permission = await Notification.requestPermission();
                setNotificationsEnabled(permission === 'granted');
            } else {
                setNotificationsEnabled(!notificationsEnabled);
            }
        } catch (e) {
            console.warn('Notification toggle failed', e);
            setNotificationsEnabled(!notificationsEnabled);
        }
    };

    const toggleWatchlist = (symbol) => {
        setWatchlist(prev => {
            if (prev.includes(symbol)) {
                return prev.filter(s => s !== symbol);
            } else {
                return [...prev, symbol];
            }
        });
    };

    const value = {
        tradingMode,
        setTradingMode,
        riskPerTrade,
        setRiskPerTrade,
        notificationsEnabled,
        toggleNotifications,
        watchlist,
        toggleWatchlist,
        isFavorite: (symbol) => watchlist.includes(symbol)
    };

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}
