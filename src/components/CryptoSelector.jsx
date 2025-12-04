import { useState, useEffect, useRef } from 'react';
import { Search, Star, Plus, X, TrendingUp } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import binanceService from '../services/binanceService';
import './CryptoSelector.css';

function CryptoSelector({ selectedSymbols, onSymbolsChange }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [availablePairs, setAvailablePairs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
    const selectorRef = useRef(null);
    const { watchlist, toggleWatchlist, isFavorite } = useSettings();

    useEffect(() => {
        if (showDropdown && availablePairs.length === 0) {
            loadAvailablePairs();
        }

        // Calculate dropdown position
        if (showDropdown && selectorRef.current) {
            const rect = selectorRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + 8, // 8px gap
                left: rect.left + 24, // Account for selector padding
                width: Math.min(500, rect.width - 48)
            });
        }
    }, [showDropdown, selectorRef]);

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
        <>
            <div className="crypto-selector glass-card mb-lg" ref={selectorRef}>
                <div className="selector-header">
                    <div className="selector-title">
                        <TrendingUp size={20} className="title-icon" />
                        <h3>Activos Monitoreados</h3>
                        <span className="badge">{selectedSymbols.length}</span>
                    </div>

                    <div className="selector-actions">
                        <button
                            className={`btn-icon ${showFavoritesOnly ? 'active' : ''}`}
                            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                            title={showFavoritesOnly ? "Mostrar todos" : "Mostrar favoritos"}
                        >
                            <Star size={18} fill={showFavoritesOnly ? '#fbbf24' : 'none'} />
                        </button>

                        <button
                            className="btn-add-crypto"
                            onClick={() => setShowDropdown(!showDropdown)}
                        >
                            <Plus size={16} />
                            Agregar
                        </button>
                    </div>
                </div>

                <div className="selected-symbols">
                    {displayedSymbols.length === 0 ? (
                        <div className="empty-state">
                            <p>No hay activos {showFavoritesOnly ? 'favoritos' : 'monitoreados'}</p>
                        </div>
                    ) : (
                        displayedSymbols.map(symbol => (
                            <div key={symbol} className="symbol-pill">
                                <button
                                    className="star-btn"
                                    onClick={() => toggleWatchlist(symbol)}
                                    title={isFavorite(symbol) ? "Quitar de favoritos" : "Agregar a favoritos"}
                                >
                                    <Star
                                        size={14}
                                        fill={isFavorite(symbol) ? '#fbbf24' : 'none'}
                                        color={isFavorite(symbol) ? '#fbbf24' : 'currentColor'}
                                    />
                                </button>
                                <span className="symbol-name">{symbol.replace('USDC', '')}</span>
                                <span className="symbol-quote">USDC</span>
                                <button
                                    className="remove-btn"
                                    onClick={() => handleRemoveSymbol(symbol)}
                                    title="Eliminar"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Dropdown as Portal */}
            {showDropdown && (
                <div
                    className="selector-dropdown"
                    style={{
                        top: `${dropdownPosition.top}px`,
                        left: `${dropdownPosition.left}px`,
                        width: `${dropdownPosition.width}px`
                    }}
                >
                    <div className="dropdown-header">
                        <div className="search-box">
                            <Search size={16} />
                            <input
                                type="text"
                                placeholder="Buscar cripto..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <button
                            onClick={() => setShowDropdown(false)}
                            className="close-dropdown-btn"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="pairs-list">
                        {loading ? (
                            <div className="loading-pairs">Cargando...</div>
                        ) : filteredPairs.length === 0 ? (
                            <div className="no-results">No se encontraron resultados</div>
                        ) : (
                            filteredPairs.map(pair => (
                                <div
                                    key={pair.symbol}
                                    className={`pair-item ${selectedSymbols.includes(pair.symbol) ? 'selected' : ''}`}
                                    onClick={() => !selectedSymbols.includes(pair.symbol) && handleAddSymbol(pair.symbol)}
                                >
                                    <span className="pair-name">{pair.baseAsset}</span>
                                    <span className="pair-quote">/{pair.quoteAsset}</span>
                                    {selectedSymbols.includes(pair.symbol) && (
                                        <span className="selected-check">✓</span>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

export default CryptoSelector;
