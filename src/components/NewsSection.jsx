import React, { useState, useEffect } from 'react';
import { Newspaper, RefreshCw, ExternalLink, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import macroService from '../services/macroService';
import './NewsSection.css';

const NewsSection = () => {
    const [news, setNews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);

    const fetchNews = async (force = false) => {
        setLoading(true);
        try {
            const articles = await macroService.getMarketNews(force);
            setNews(articles);
            setLastUpdated(new Date());
        } catch (error) {
            console.error('Failed to fetch news:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchNews();
    }, []);

    const handleRefresh = () => {
        fetchNews(true);
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <section className="news-section">
            <div className="signals-header">
                <div className="section-header">
                    <Newspaper size={20} className="text-primary" />
                    <h2 className="signals-title">
                        INTELIGENCIA DE MERCADO
                        {!loading && news.length > 0 && (
                            <span className="signal-count" style={{ background: 'var(--color-primary)', color: 'black' }}>
                                {news.length}
                            </span>
                        )}
                    </h2>
                </div>
                <div className="flex items-center gap-md">
                    {lastUpdated && !loading && (
                        <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                            ACTUALIZADO: {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                    <button
                        className={`btn-secondary flex items-center gap-sm ${loading ? 'pulse' : ''}`}
                        onClick={handleRefresh}
                        disabled={loading}
                        style={{ padding: '0.5rem 1rem' }}
                    >
                        <RefreshCw size={14} className={loading ? 'spin' : ''} />
                        {loading ? 'SINCRO...' : 'REFRESCAR'}
                    </button>
                </div>
            </div>

            {loading && news.length === 0 ? (
                <div className="news-empty pulse">
                    ANALIZANDO FLUJOS DE INFORMACIÓN...
                </div>
            ) : news.length === 0 ? (
                <div className="news-empty">
                    SIN NOTICIAS RELEVANTES EN ESTE MOMENTO
                </div>
            ) : (
                <div className="news-grid">
                    <AnimatePresence mode='popLayout'>
                        {news.map((item, idx) => (
                            <motion.a
                                key={item.url || idx}
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="news-card"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.05 }}
                                whileHover={{ y: -4 }}
                            >
                                <div className="news-meta">
                                    <span className="news-source">{item.source}</span>
                                    <span className="flex items-center gap-sm">
                                        <Clock size={10} />
                                        {formatDate(item.publishedAt)}
                                    </span>
                                </div>
                                <h3 className="news-title">{item.title}</h3>
                                <p className="news-summary">{item.summary}</p>
                                <div className="news-footer">
                                    LEER REPORTE <ExternalLink size={12} />
                                </div>
                            </motion.a>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </section>
    );
};

export default NewsSection;
