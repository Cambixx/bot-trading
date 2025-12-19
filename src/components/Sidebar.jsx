import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard, Briefcase, FlaskConical, Settings, Zap, LineChart, X } from 'lucide-react';
import './Sidebar.css';

function Sidebar({ isOpen, toggleSidebar }) {
    return (
        <>
            {/* Overlay for mobile */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="sidebar-overlay"
                        onClick={toggleSidebar}
                    />
                )}
            </AnimatePresence>

            <motion.aside
                initial={false}
                animate={{ x: isOpen || window.innerWidth > 768 ? 0 : -280 }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className={`sidebar ${isOpen ? 'open' : ''}`}
            >
                <div className="sidebar-header">
                    <div className="logo-container">
                        <div className="logo-box">
                            <Zap className="logo-icon" size={20} />
                        </div>
                        <span className="logo-text">Trading<span className="text-primary">Bot</span></span>
                    </div>
                    <button className="mobile-close-btn" onClick={toggleSidebar}>
                        <X size={20} />
                    </button>
                </div>

                <nav className="sidebar-nav">
                    <NavLink
                        to="/"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                        end
                    >
                        <LayoutDashboard size={18} />
                        <span>Dashboard</span>
                        {/* Dot indicator for active state if needed */}
                    </NavLink>

                    <NavLink
                        to="/chart"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                    >
                        <LineChart size={18} />
                        <span>Gráfico</span>
                    </NavLink>

                    <NavLink
                        to="/portfolio"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                    >
                        <Briefcase size={18} />
                        <span>Cartera</span>
                    </NavLink>

                    <NavLink
                        to="/backtest"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                    >
                        <FlaskConical size={18} />
                        <span>Backtest</span>
                    </NavLink>

                    <div className="nav-divider"></div>

                    <NavLink
                        to="/settings"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                    >
                        <Settings size={18} />
                        <span>Ajustes</span>
                    </NavLink>
                </nav>

                <div className="sidebar-footer">
                    <div className="version-tag">
                        <span>v1.0.0</span>
                    </div>
                </div>
            </motion.aside>
        </>
    );
}

export default Sidebar;
