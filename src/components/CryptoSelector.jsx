import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Star, Plus, X, TrendingUp, Zap, ChevronDown } from 'lucide-react';
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
    const selectorRef = useRef(null);
    const { watchlist, toggleWatchlist, isFavorite } = useSettings();

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

        if (showDropdown && selectorRef.current) {
            const rect = selectorRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + 8,
                left: rect.left,
                width: rect.width
            });
        }
    }, [showDropdown]);

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
        setShowDropdown(false);
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

    return (
        <div className="crypto-selector-container">
            <div className="crypto-selector glass-card" ref={selectorRef}>
                <div className="selector-header">
                    <div className="selector-title">
                        <div className="title-icon-box">
                            <TrendingUp size={16} />
                        </div>
                        <h3>Monitoreo</h3>
                        <span className="count-badge">{selectedSymbols.length}</span>
                    </div>

                    <div className="selector-actions">
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className={`action-btn scan-btn ${scanning ? 'scanning' : ''}`}
                            onClick={handleSmartScan}
                            disabled={scanning}
                        >
                            <Zap size={14} className={scanning ? 'spin' : ''} />
                            <span>Scan</span>
                        </motion.button>

                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className={`action-btn fav-btn ${showFavoritesOnly ? 'active' : ''}`}
                            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                        >
                            <Star size={14} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
                        </motion.button>

                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="btn-add-main"
                            onClick={() => setShowDropdown(!showDropdown)}
                        >
                            <Plus size={14} />
                            <span>Agregar</span>
                        </motion.button>
                    </div>
                </div>

                <div className="selected-symbols-grid">
                    <AnimatePresence>
                        {displayedSymbols.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="empty-selection"
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
                                        <Star size={12} fill={isFavorite(symbol) ? 'currentColor' : 'none'} />
                                    </button>
                                    <span className="pill-name">{symbol.replace('USDC', '').replace('USDT', '')}</span>
                                    <button
                                        className="pill-remove"
                                        onClick={() => handleRemoveSymbol(symbol)}
                                    >
                                        <X size={12} />
                                    </button>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <AnimatePresence>
                {showDropdown && (
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
                            <Search size={16} className="search-icon" />
                            <input
                                type="text"
                                placeholder="Busca un activo (BTC, ETH...)"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                            <button className="close-btn" onClick={() => setShowDropdown(false)}>
                                <X size={16} />
                            </button>
                        </div>

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
                                    {filteredPairs.map(pair => (
                                        <motion.div
                                            whileHover={{ x: 4 }}
                                            key={pair.symbol}
                                            className={`pair-row ${selectedSymbols.includes(pair.symbol) ? 'selected' : ''}`}
                                            onClick={() => !selectedSymbols.includes(pair.symbol) && handleAddSymbol(pair.symbol)}
                                        >
                                            <div className="pair-info">
                                                <span className="b-asset">{pair.baseAsset}</span>
                                                <span className="q-asset">/{pair.quoteAsset}</span>
                                            </div>
                                            {selectedSymbols.includes(pair.symbol) ? (
                                                <div className="selected-dot" />
                                            ) : (
                                                <Plus size={14} className="add-plus" />
                                            )}
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {showDropdown && (
                <div className="dropdown-backdrop" onClick={() => setShowDropdown(false)} />
            )}
        </div>
    );
}

export default CryptoSelector;
