import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Briefcase, FlaskConical, Settings, Zap } from 'lucide-react';
import './Sidebar.css';

function Sidebar() {
    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <Zap className="logo-icon" size={28} />
                <span className="logo-text">TradingBot</span>
            </div>

            <nav className="sidebar-nav">
                <NavLink
                    to="/"
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    end
                >
                    <LayoutDashboard size={20} />
                    <span>Dashboard</span>
                </NavLink>

                <NavLink
                    to="/portfolio"
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                    <Briefcase size={20} />
                    <span>Cartera</span>
                </NavLink>

                <NavLink
                    to="/backtest"
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                    <FlaskConical size={20} />
                    <span>Backtest</span>
                </NavLink>

                <div className="nav-divider"></div>

                <NavLink
                    to="/settings"
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                    <Settings size={20} />
                    <span>Ajustes</span>
                </NavLink>
            </nav>

            <div className="sidebar-footer">
                <p>v1.0.0</p>
            </div>
        </aside>
    );
}

export default Sidebar;
