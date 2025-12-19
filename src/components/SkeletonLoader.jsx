import './SkeletonLoader.css';

export function SkeletonCryptoCard() {
  return (
    <div className="skeleton-card-premium">
      <div className="skeleton-header-row">
        <div className="skeleton-box-small"></div>
        <div className="skeleton-line-medium"></div>
      </div>

      <div className="skeleton-body-area">
        <div className="skeleton-line-large"></div>
        <div className="skeleton-line-small"></div>
      </div>

      <div className="skeleton-viz-box">
        <div className="skeleton-circle-viz"></div>
      </div>
    </div>
  );
}

export function SkeletonSignalCard() {
  return (
    <div className="skeleton-card-premium skeleton-signal-p">
      <div className="skeleton-header-row">
        <div className="skeleton-box-small"></div>
        <div className="skeleton-badge-s"></div>
      </div>

      <div className="skeleton-body-area">
        <div className="skeleton-line-large"></div>
        <div className="skeleton-grid-lines">
          <div className="skeleton-line-s"></div>
          <div className="skeleton-line-s"></div>
        </div>
      </div>

      <div className="skeleton-footer-s">
        <div className="skeleton-line-ts"></div>
        <div className="skeleton-btn-s"></div>
      </div>
    </div>
  );
}

export default function SkeletonLoader({ type = 'crypto', count = 4 }) {
  const components = [];

  for (let i = 0; i < count; i++) {
    components.push(
      type === 'signal' ? <SkeletonSignalCard key={i} /> : <SkeletonCryptoCard key={i} />
    );
  }

  return <>{components}</>;
}
