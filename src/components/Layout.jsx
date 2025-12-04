import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import './Layout.css';

function Layout({ children }) {
    return (
        <div className="layout">
            <Sidebar />
            <main className="main-content">
                <div className="content-wrapper">
                    {/* Status Bar will be injected here via Outlet context or props if needed, 
              but for now we might keep it in the specific pages or move it here later.
              Actually, the plan says "Displays the global StatusBar". 
              Let's allow children to render it or pass it as a prop.
          */}
                    {children || <Outlet />}
                </div>
            </main>
        </div>
    );
}

export default Layout;
