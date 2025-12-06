import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, Zap } from 'lucide-react';
import Sidebar from './Sidebar';
import './Layout.css';

function Layout({ children }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const toggleSidebar = () => {
        setSidebarOpen(!sidebarOpen);
    };

    return (
        <div className="layout">
            <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />

            <main className="main-content">
                {/* Mobile Header */}
                <header className="mobile-header">
                    <button className="menu-btn" onClick={toggleSidebar}>
                        <Menu size={24} />
                    </button>
                    <div className="mobile-logo">
                        <Zap className="logo-icon" size={20} />
                        <span className="logo-text">TradingBot</span>
                    </div>
                    <div style={{ width: 24 }}></div> {/* Spacer for centering */}
                </header>

                <div className="content-wrapper">
                    {children || <Outlet />}
                </div>
            </main>
        </div>
    );
}

export default Layout;
