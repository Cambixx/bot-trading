import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Star, Plus, X, TrendingUp, Zap, ChevronDown, Monitor, Smartphone } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import binanceService from '../services/binanceService';
import './CryptoSelector.css';

function CryptoSelector({ selectedSymbols, onSymbolsChange }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [availablePairs, setAvailablePairs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const selectorRef = useRef(null);
    const { watchlist, toggleWatchlist, isFavorite } = useSettings();

    // Detección de Mobile
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handleSmartScan = async () => {
        if (scanning) return;
        setScanning(true);
        try {
            const smartCoins = await binanceService.getSmartOpportunityCoins(12);
            if (smartCoins && smartCoins.length > 0) {
                const mergedSymbols = [...new Set([...watchlist, ...smartCoins])];
                onSymbolsChange(mergedSymbols);
            }
        } catch (error) {
            console.error('Smart scan failed:', error);
        }
        setScanning(false);
    };

    useEffect(() => {
        if (showDropdown && availablePairs.length === 0) {
            loadAvailablePairs();
        }

        if (showDropdown && selectorRef.current && !isMobile) {
            const rect = selectorRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + 8,
                left: rect.left,
                width: rect.width
            });
        }
    }, [showDropdown, isMobile]);

    const loadAvailablePairs = async () => {
        setLoading(true);
        try {
            const pairs = await binanceService.getAvailableUSDCPairs();
            setAvailablePairs(pairs);
        } catch (error) {
            console.error('Error loading pairs:', error);
        }
        setLoading(false);
    };

    const handleAddSymbol = (symbol) => {
        if (!selectedSymbols.includes(symbol)) {
            onSymbolsChange([...selectedSymbols, symbol]);
        }
        setSearchTerm('');
        if (!isMobile) setShowDropdown(false);
    };

    const handleRemoveSymbol = (symbol) => {
        onSymbolsChange(selectedSymbols.filter(s => s !== symbol));
    };

    const displayedSymbols = showFavoritesOnly
        ? selectedSymbols.filter(s => isFavorite(s))
        : selectedSymbols;

    const filteredPairs = availablePairs.filter(pair =>
        pair.baseAsset.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pair.symbol.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Componente de Lista de Pares (Reutilizable)
    const PairsList = () => (
        <div className="pairs-scroll-area">
            {loading ? (
                <div className="loading-dropdown">
                    <div className="drop-loader" />
                    <span>Actualizando activos...</span>
                </div>
            ) : filteredPairs.length === 0 ? (
                <div className="no-pairs">No se encontraron activos</div>
            ) : (
                <div className="pairs-grid-mini">
                    {filteredPairs.map(pair => {
                        const isSelected = selectedSymbols.includes(pair.symbol);
                        return (
                            <motion.div
                                whileHover={!isSelected ? { scale: 1.02, y: -2 } : {}}
                                whileTap={!isSelected ? { scale: 0.98 } : {}}
                                key={pair.symbol}
                                className={`pair-row ${isSelected ? 'selected' : ''}`}
                                onClick={() => !isSelected && handleAddSymbol(pair.symbol)}
                            >
                                <div className="pair-info">
                                    <span className="b-asset">{pair.baseAsset}</span>
                                    <span className="q-asset">/{pair.quoteAsset}</span>
                                </div>
                                {isSelected ? (
                                    <div className="selected-dot" />
                                ) : (
                                    <Plus size={14} className="add-plus" />
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <div className="crypto-selector-container">
            <div className="crypto-selector glass-card" ref={selectorRef}>
                <div className="selector-header">
                    <div className="selector-title">
                        <div className="title-icon-box">
                            <TrendingUp size={20} />
                        </div>
                        <div className="title-text">
                            <h3>Monitoreo</h3>
                            <span className="count-badge">{selectedSymbols.length} Activos</span>
                        </div>
                    </div>

                    <div className="selector-actions">
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className={`action-btn scan-btn ${scanning ? 'active' : ''}`}
                            onClick={handleSmartScan}
                            disabled={scanning}
                            title="Escaneo Inteligente"
                        >
                            <Zap size={16} className={scanning ? 'spin' : ''} />
                            <span>Scan</span>
                        </motion.button>

                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className={`action-btn fav-btn ${showFavoritesOnly ? 'active' : ''}`}
                            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                            title="Ver Favoritos"
                        >
                            <Star size={16} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
                        </motion.button>

                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="btn-add-main"
                            onClick={() => setShowDropdown(!showDropdown)}
                        >
                            <Plus size={18} />
                            <span>Agregar</span>
                        </motion.button>
                    </div>
                </div>

                <div className="selected-symbols-grid">
                    <AnimatePresence mode="popLayout">
                        {displayedSymbols.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="empty-selection"
                                key="empty"
                            >
                                <p>No hay activos {showFavoritesOnly ? 'favoritos' : 'monitoreados'}</p>
                            </motion.div>
                        ) : (
                            displayedSymbols.map(symbol => (
                                <motion.div
                                    layout
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    key={symbol}
                                    className="symbol-pill-premium"
                                >
                                    <button
                                        className={`favorite-toggle ${isFavorite(symbol) ? 'active' : ''}`}
                                        onClick={() => toggleWatchlist(symbol)}
                                    >
                                        <Star size={14} fill={isFavorite(symbol) ? 'currentColor' : 'none'} />
                                    </button>
                                    <span className="pill-name">{(symbol || '').replace('USDC', '').replace('USDT', '')}</span>
                                    <button
                                        className="pill-remove"
                                        onClick={() => handleRemoveSymbol(symbol)}
                                    >
                                        <X size={14} />
                                    </button>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <AnimatePresence>
                {showDropdown && (
                    <>
                        {isMobile ? (
                            <>
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="mobile-drawer-overlay"
                                    onClick={() => setShowDropdown(false)}
                                />
                                <motion.div
                                    initial={{ y: '100%' }}
                                    animate={{ y: 0 }}
                                    exit={{ y: '100%' }}
                                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                                    className="mobile-drawer"
                                >
                                    <div className="drawer-handle" />
                                    <div className="dropdown-search">
                                        <div className="search-input-wrapper">
                                            <Search size={18} />
                                            <input
                                                type="text"
                                                placeholder="Busca un activo..."
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                autoFocus
                                            />
                                        </div>
                                        <button className="action-btn" onClick={() => setShowDropdown(false)}>
                                            <X size={20} />
                                        </button>
                                    </div>
                                    <PairsList />
                                </motion.div>
                            </>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                className="selector-dropdown-premium"
                                style={{
                                    top: `${dropdownPosition.top}px`,
                                    left: `${dropdownPosition.left}px`,
                                    width: `${dropdownPosition.width}px`
                                }}
                            >
                                <div className="dropdown-search">
                                    <div className="search-input-wrapper">
                                        <Search size={16} />
                                        <input
                                            type="text"
                                            placeholder="Busca un activo (BTC, ETH...)"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            autoFocus
                                        />
                                    </div>
                                    <button className="action-btn" onClick={() => setShowDropdown(false)}>
                                        <X size={16} />
                                    </button>
                                </div>
                                <PairsList />
                            </motion.div>
                        )}
                    </>
                )}
            </AnimatePresence>

            {showDropdown && !isMobile && (
                <div className="dropdown-backdrop" onClick={() => setShowDropdown(false)} />
            )}
        </div>
    );
}

export default CryptoSelector;
