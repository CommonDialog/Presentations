import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMarkNotificationRead, useNotifications } from '../api/workflowHooks.js';

export function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const unread = data?.unread ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        className="relative rounded px-1.5 py-0.5 text-lg hover:bg-gray-100"
        aria-label={`Notifications (${unread} unread)`}
        onClick={() => setOpen((s) => !s)}
      >
        🔔
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-10 mt-1 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
          <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
            {data?.notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                    notification.read ? 'text-gray-500' : 'font-medium text-gray-900'
                  }`}
                  onClick={() => {
                    if (!notification.read) markRead.mutate(notification.id);
                    setOpen(false);
                    if (notification.link) navigate(notification.link);
                  }}
                >
                  <span className="block">{notification.message}</span>
                  <span className="block text-xs font-normal text-gray-400">
                    {new Date(notification.createdAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
            {data && data.notifications.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-gray-500">No notifications.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
