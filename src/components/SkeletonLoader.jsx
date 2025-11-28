import './SkeletonLoader.css';

export function SkeletonCryptoCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-header">
        <div className="skeleton-text skeleton-title"></div>
        <div className="skeleton-text skeleton-subtitle"></div>
      </div>
      
      <div className="skeleton-content">
        <div className="skeleton-row">
          <div className="skeleton-text skeleton-large"></div>
          <div className="skeleton-text skeleton-small"></div>
        </div>
        
        <div className="skeleton-row">
          <div className="skeleton-text skeleton-medium"></div>
          <div className="skeleton-text skeleton-medium"></div>
        </div>
        
        <div className="skeleton-row">
          <div className="skeleton-text skeleton-small"></div>
          <div className="skeleton-text skeleton-small"></div>
        </div>
      </div>
      
      <div className="skeleton-footer">
        <div className="skeleton-button"></div>
      </div>
    </div>
  );
}

export function SkeletonSignalCard() {
  return (
    <div className="skeleton-card skeleton-signal">
      <div className="skeleton-header">
        <div className="skeleton-text skeleton-title"></div>
        <div className="skeleton-badge"></div>
      </div>
      
      <div className="skeleton-content">
        <div className="skeleton-row">
          <div className="skeleton-text skeleton-medium"></div>
          <div className="skeleton-text skeleton-small"></div>
        </div>
        
        <div className="skeleton-row">
          <div className="skeleton-text skeleton-medium"></div>
        </div>
        
        <div className="skeleton-row">
          <div className="skeleton-text skeleton-small"></div>
          <div className="skeleton-text skeleton-small"></div>
        </div>
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
