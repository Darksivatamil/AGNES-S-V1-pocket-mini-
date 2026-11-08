"use client";

import { useState } from "react";
import { Bell, Check, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { EmptyState, HonestyNote, PageHeader, SectionCard } from "@/components/ui";
import { callAgnes, errorMessage, newRequestId } from "@/lib/api";
import { notificationKinds } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import type { Notification } from "@/lib/types";

type DeviceRef = { id: string; name: string };
type Kind = Notification["kind"];

export function NotificationsClient({
  initialNotifications,
  devices,
}: {
  initialNotifications: Notification[];
  devices: DeviceRef[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<Kind>("info");
  const [deviceId, setDeviceId] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const deviceNames = new Map(devices.map((device) => [device.id, device.name]));
  const visible =
    filter === "unread" ? notifications.filter((notification) => !notification.read_at) : notifications;
  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const result = await callAgnes<{ notifications: Notification[] }>("agnes-notifications", {
        action: "list",
        limit: 60,
      });
      setNotifications(result.notifications);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRefreshing(false);
    }
  }

  async function createNotification(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await callAgnes<{ notification: Notification }>("agnes-notifications", {
        action: "create",
        request_id: newRequestId(),
        title: title.trim(),
        body: body.trim(),
        kind,
        ...(deviceId ? { device_id: deviceId } : {}),
      });
      setNotifications((current) => [result.notification, ...current]);
      setTitle("");
      setBody("");
      setKind("info");
      setNotice("Notification queued. The device shows it after the next sync if notifications are enabled.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function markRead(notification: Notification) {
    if (notification.read_at) return;
    setBusyId(notification.id);
    setError(null);
    try {
      const result = await callAgnes<{ notification: { id: string; read_at: string } }>(
        "agnes-notifications",
        { action: "mark_read", id: notification.id },
      );
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, read_at: result.notification.read_at } : item,
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(notification: Notification) {
    if (!window.confirm(`Delete “${notification.title}”?`)) return;
    setBusyId(notification.id);
    setError(null);
    try {
      await callAgnes("agnes-notifications", { action: "delete", id: notification.id });
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Device inbox"
        title="Notifications"
        description="Unread notifications are delivered to the device on sync. Reading one here or on the device removes it from the unread device list."
        action={
          <button type="button" className="btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`btn btn-sm ${filter === "all" ? "btn-primary" : ""}`}
              onClick={() => setFilter("all")}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filter === "unread" ? "btn-primary" : ""}`}
              onClick={() => setFilter("unread")}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title={filter === "unread" ? "Inbox zero" : "No notifications"}
              description={
                filter === "unread"
                  ? "Everything has been read or deleted."
                  : "Create a notification on the right to send a message to the OLED."
              }
            />
          ) : (
            <div className="space-y-2">
              {visible.map((notification) => (
                <article
                  key={notification.id}
                  className={`card p-4 ${notification.read_at ? "opacity-70" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          notification.read_at ? "bg-slate-600" : "bg-mint"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h2 className="text-sm font-bold text-white">{notification.title}</h2>
                          <span className="badge">{notification.kind}</span>
                          {notification.read_at ? (
                            <span className="badge badge-muted">read</span>
                          ) : (
                            <span className="badge badge-amber">unread</span>
                          )}
                        </div>
                        {notification.body ? (
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">
                            {notification.body}
                          </p>
                        ) : null}
                        <p className="mt-1.5 text-[0.62rem] text-[#587088]">
                          {notification.device_id
                            ? `to ${deviceNames.get(notification.device_id) ?? "removed device"}`
                            : "all devices"}{" "}
                          · {relativeTime(notification.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {!notification.read_at ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => markRead(notification)}
                          disabled={busyId === notification.id}
                          title="Mark as read"
                        >
                          {busyId === notification.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Check size={11} />
                          )}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-sm text-rose-300"
                        onClick={() => remove(notification)}
                        disabled={busyId === notification.id}
                        title="Delete notification"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SectionCard title="Send a notification" description="Delivered on the next device sync.">
            <form onSubmit={createNotification} className="space-y-3">
              <div>
                <label className="label" htmlFor="notification-title">
                  Title
                </label>
                <input
                  id="notification-title"
                  className="input"
                  maxLength={160}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Drink some water"
                />
              </div>
              <div>
                <label className="label" htmlFor="notification-body">
                  Body
                </label>
                <textarea
                  id="notification-body"
                  className="textarea min-h-[90px]"
                  maxLength={1000}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Optional detail"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="notification-kind">
                    Kind
                  </label>
                  <select
                    id="notification-kind"
                    className="select"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as Kind)}
                  >
                    {notificationKinds.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="notification-device">
                    Device
                  </label>
                  <select
                    id="notification-device"
                    className="select"
                    value={deviceId}
                    onChange={(event) => setDeviceId(event.target.value)}
                  >
                    <option value="">All devices</option>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={creating || !title.trim()}
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Send notification
              </button>
            </form>
          </SectionCard>

          <SectionCard title="Delivery rules" description="No push socket involved.">
            <ul className="space-y-2 text-[0.72rem] leading-5 text-muted">
              <li>• The device requests up to 5 unread notifications per sync.</li>
              <li>• Reading on either surface is synced; read items disappear from the device list.</li>
              <li>• Device notifications can be disabled in settings, which stops delivery.</li>
              <li>• Notifications are not SMS or push notifications; they live in the AGNES inbox.</li>
            </ul>
          </SectionCard>

          {notice ? (
            <p className="rounded-xl border border-mint/25 bg-mint/[0.07] px-3 py-2 text-xs text-mint-100">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-rose/30 bg-rose/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </p>
          ) : null}

          <HonestyNote>
            This dashboard cannot verify that the device displayed a notification. Delivery is
            recorded when the device fetches it during sync.
          </HonestyNote>
        </div>
      </div>
    </div>
  );
}
