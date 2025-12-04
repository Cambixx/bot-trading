import Portfolio from '../components/Portfolio';
import WinRateStats from '../components/WinRateStats';

function PortfolioPage({ portfolio, cryptoData, closePosition, resetPortfolio, stats, history }) {
    return (
        <div className="portfolio-page fade-in">
            <h2 className="mb-lg">Mi Cartera</h2>

            <section className="portfolio-section mb-xl">
                <Portfolio
                    portfolio={portfolio}
                    currentPrices={cryptoData}
                    onClosePosition={closePosition}
                    onReset={resetPortfolio}
                />
            </section>

            {/* Win Rate Stats */}
            <section className="winrate-section mb-xl">
                <WinRateStats
                    stats={stats}
                    recentSignals={history.filter(s => s.status === 'WIN' || s.status === 'LOSS')}
                />
            </section>
        </div>
    );
}

export default PortfolioPage;
