import BacktestDashboard from '../components/BacktestDashboard';

function BacktestPage({ symbols }) {
    return (
        <div className="backtest-page fade-in">
            <BacktestDashboard symbols={symbols} />
        </div>
    );
}

export default BacktestPage;
