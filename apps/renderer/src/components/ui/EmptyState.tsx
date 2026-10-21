import type { FC, ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: FC<EmptyStateProps> = ({ icon, title, description, action }) => {
  return (
    <div className="empty-state-container">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="empty-state-action-btn">
          {action.label}
        </button>
      )}
    </div>
  );
};
