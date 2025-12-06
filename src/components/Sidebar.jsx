import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Briefcase, FlaskConical, Settings, Zap, LineChart, X } from 'lucide-react';
import './Sidebar.css';

function Sidebar({ isOpen, toggleSidebar }) {
    return (
        <>
            {/* Overlay for mobile */}
            {isOpen && <div className="sidebar-overlay" onClick={toggleSidebar}></div>}

            <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <Zap className="logo-icon" size={28} />
                    <span className="logo-text">TradingBot</span>
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
                        <LayoutDashboard size={20} />
                        <span>Dashboard</span>
                    </NavLink>

                    <NavLink
                        to="/chart"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                    >
                        <LineChart size={20} />
                        <span>Gráfico</span>
                    </NavLink>

                    <NavLink
                        to="/portfolio"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                    >
                        <Briefcase size={20} />
                        <span>Cartera</span>
                    </NavLink>

                    <NavLink
                        to="/backtest"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                    >
                        <FlaskConical size={20} />
                        <span>Backtest</span>
                    </NavLink>

                    <div className="nav-divider"></div>

                    <NavLink
                        to="/settings"
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => window.innerWidth <= 768 && toggleSidebar()}
                    >
                        <Settings size={20} />
                        <span>Ajustes</span>
                    </NavLink>
                </nav>

                <div className="sidebar-footer">
                    <p>v1.0.0</p>
                </div>
            </aside>
        </>
    );
}

export default Sidebar;
