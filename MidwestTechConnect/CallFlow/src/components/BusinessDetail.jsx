import { ArrowLeft, MapPin, Phone } from 'lucide-react';
import { categoryLabel } from '../data/businesses.js';

export default function BusinessDetail({ business, onBack, onCall }) {
  return (
    <div className="space-y-6">
      <button type="button" className="btn-outline !w-auto" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" />
        Back to results
      </button>

      <div className="card p-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">{business.name}</h1>
          <p className="text-muted text-lg">{categoryLabel(business.category)}</p>
        </div>

        <dl className="space-y-2 text-lg">
          <div className="flex items-center gap-3">
            <dt className="sr-only">Phone</dt>
            <Phone size={20} className="text-muted" aria-hidden="true" />
            <dd className="m-0">{business.phone}</dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="sr-only">Location</dt>
            <MapPin size={20} className="text-muted" aria-hidden="true" />
            <dd className="m-0">{business.location}</dd>
          </div>
        </dl>

        <button type="button" className="btn-primary text-xl py-5" onClick={() => onCall(business)}>
          <Phone size={24} aria-hidden="true" />
          Call {business.name}
        </button>
      </div>
    </div>
  );
}
