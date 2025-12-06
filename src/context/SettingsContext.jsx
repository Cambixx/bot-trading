import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { useAuth } from './AuthContext';

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
    const { user } = useAuth();

    // Trading Mode
    const [tradingMode, setTradingMode] = useState('BALANCED');
    // Risk Management
    const [riskPerTrade, setRiskPerTrade] = useState(1000);
    // Watchlist
    const [watchlist, setWatchlist] = useState([]);

    // Notifications (Local only for now)
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);

    const isLoaded = useRef(false);

    // Load settings from Supabase when user logs in
    useEffect(() => {
        if (!user) return;

        const loadSettings = async () => {
            try {
                const { data, error } = await supabase
                    .from('user_preferences')
                    .select('*')
                    .eq('user_id', user.id)
                    .single();

                if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
                    console.error('Error loading settings:', error);
                    return;
                }

                if (data) {
                    console.log('✅ Settings loaded:', data);
                    setTradingMode(data.trading_mode || 'BALANCED');
                    setRiskPerTrade(data.risk_per_trade || 1000);
                    setWatchlist(data.watchlist || []);
                } else {
                    console.log('⚠️ No settings found, creating default.');
                    // Create default profile if not exists
                    const { error: insertError } = await supabase.from('user_preferences').insert([{
                        user_id: user.id,
                        trading_mode: 'BALANCED',
                        risk_per_trade: 1000,
                        watchlist: []
                    }]);
                    if (insertError) console.error('Error creating default settings:', insertError);
                }
            } catch (err) {
                console.error('Unexpected error loading settings:', err);
            } finally {
                isLoaded.current = true;
            }
        };

        loadSettings();
    }, [user]);

    // Sync updates to Supabase
    useEffect(() => {
        if (!user || !isLoaded.current) return;

        const saveSettings = async () => {
            console.log('💾 Saving settings...', { tradingMode, watchlist });
            try {
                const { error } = await supabase.from('user_preferences').upsert({
                    user_id: user.id,
                    trading_mode: tradingMode,
                    risk_per_trade: riskPerTrade,
                    watchlist: watchlist,
                    updated_at: new Date()
                });
                if (error) console.error('❌ Error saving settings:', error);
                else console.log('✅ Settings saved');
            } catch (err) {
                console.error('Error saving settings:', err);
            }
        };

        // Debounce simple to avoid too many writes? 
        // For now direct write is fine, Supabase handles it well. 
        // But maybe a small timeout for rapid watchlist toggles.
        const timeoutId = setTimeout(saveSettings, 500);
        return () => clearTimeout(timeoutId);

    }, [tradingMode, riskPerTrade, watchlist, user]);


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
        console.log('⭐ Toggling favorite:', symbol);
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
