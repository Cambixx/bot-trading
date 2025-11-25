import { useState, useEffect } from 'react';
import { Plus, X, Search } from 'lucide-react';
import './CryptoSelector.css';
import binanceService from '../services/binanceService';

function CryptoSelector({ selectedSymbols, onSymbolsChange }) {
    const [isOpen, setIsOpen] = useState(false);
    const [availablePairs, setAvailablePairs] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && availablePairs.length === 0) {
            loadAvailablePairs();
        }
    }, [isOpen]);

    const loadAvailablePairs = async () => {
        setLoading(true);
        try {
            const pairs = await binanceService.getAvailableUSDTPairs();
            setAvailablePairs(pairs);
        } catch (error) {
            console.error('Error loading pairs:', error);
        }
        setLoading(false);
    };

    const addSymbol = (symbol) => {
        if (!selectedSymbols.includes(symbol)) {
            onSymbolsChange([...selectedSymbols, symbol]);
        }
        setSearchTerm('');
    };

    const removeSymbol = (symbol) => {
        onSymbolsChange(selectedSymbols.filter(s => s !== symbol));
    };

    const filteredPairs = availablePairs.filter(pair =>
        pair.baseAsset.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pair.symbol.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="crypto-selector">
            {/* Selected Symbols */}
            <div className="selected-symbols">
                {selectedSymbols.map(symbol => (
                    <div key={symbol} className="symbol-tag">
                        <span>{symbol.replace('USDT', '')}</span>
                        <button
                            onClick={() => removeSymbol(symbol)}
                            className="remove-btn"
                            title="Remover"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}

                {/* Add Button */}
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="add-symbol-btn"
                    title="Agregar criptomoneda"
                >
                    <Plus size={16} />
                    Agregar
                </button>
            </div>

            {/* Dropdown */}
            {isOpen && (
                <div className="selector-dropdown">
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
                            onClick={() => setIsOpen(false)}
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
                                    onClick={() => !selectedSymbols.includes(pair.symbol) && addSymbol(pair.symbol)}
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
        </div>
    );
}

export default CryptoSelector;
