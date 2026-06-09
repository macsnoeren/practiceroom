import type { ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { APP_NAME, type UserDto } from '@practiceroom/shared';
import { useTheme } from '../useTheme.js';
import { LessonManagement } from './LessonManagement.js';
import { LessonDashboard } from './LessonDashboard.js';
import { DeviceManagement } from './DeviceManagement.js';
import { UserManagement } from './UserManagement.js';
import { StudentLessons } from './StudentLessons.js';
import { HolidayManagement } from './HolidayManagement.js';
import { RoomManagement } from './RoomManagement.js';
import { ProfilePage } from './ProfilePage.js';

const ROLE_LABEL: Record<UserDto['role'], string> = {
  admin: 'Beheerder',
  teacher: 'Leraar',
  student: 'Student',
};

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link active' : 'nav-link';

export function AppShell({
  user,
  onLogout,
  onUserUpdate,
}: {
  user: UserDto;
  onLogout: () => void;
  onUserUpdate: (u: UserDto) => void;
}) {
  const isStaff = user.role !== 'student';
  const isAdmin = user.role === 'admin';
  const { theme, toggle } = useTheme();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">P</span>
          {APP_NAME}
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-user">
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Licht thema' : 'Donker thema'}
            title={theme === 'dark' ? 'Licht thema' : 'Donker thema'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <Link to="/profile" className="who" title="Mijn profiel">
            <strong>{user.name}</strong>
            <small>{ROLE_LABEL[user.role]}</small>
          </Link>
          <button type="button" className="secondary" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </header>

      <nav className="sidebar">
        {isStaff ? (
          <>
            <NavLink to="/lessons" className={navClass}>
              <span className="ico">🎵</span> Lessen
            </NavLink>
            <NavLink to="/devices" className={navClass}>
              <span className="ico">🎥</span> Camera&rsquo;s
            </NavLink>
            <NavLink to="/rooms" className={navClass}>
              <span className="ico">🚪</span> Lokalen
            </NavLink>
            <NavLink to="/holidays" className={navClass}>
              <span className="ico">🏖️</span> Vakanties
            </NavLink>
            <NavLink to="/users" className={navClass}>
              <span className="ico">👥</span> Gebruikers
            </NavLink>
          </>
        ) : (
          <NavLink to="/lessons" className={navClass}>
            <span className="ico">🎵</span> Mijn lessen
          </NavLink>
        )}
      </nav>

      <main className="main">
        <Routes>
          {isStaff ? (
            <>
              <Route
                path="/lessons"
                element={
                  <Page
                    title="Lessen"
                    subtitle="Plan lessen, kies camera's, neem op en kijk terug."
                  >
                    <LessonManagement isAdmin={isAdmin} />
                  </Page>
                }
              />
              <Route
                path="/lessons/:id"
                element={
                  <div className="page">
                    <LessonDashboard />
                  </div>
                }
              />
              <Route
                path="/devices"
                element={
                  <Page
                    title="Camera's & microfoons"
                    subtitle="Registreer en koppel opnameapparaten."
                  >
                    <DeviceManagement />
                  </Page>
                }
              />
              <Route
                path="/rooms"
                element={
                  <Page title="Lokalen" subtitle="Beheer de lokalen waar lessen plaatsvinden.">
                    <RoomManagement canManage={isAdmin} />
                  </Page>
                }
              />
              <Route
                path="/holidays"
                element={
                  <Page
                    title="Vakanties"
                    subtitle="Voer schoolvakanties in; herhalende lessen slaan deze over."
                  >
                    <HolidayManagement canManage={isAdmin} />
                  </Page>
                }
              />
              <Route
                path="/users"
                element={
                  <Page title="Gebruikers" subtitle="Beheer de leraren en studenten van je school.">
                    <UserManagement canManage={isAdmin} me={user} />
                  </Page>
                }
              />
            </>
          ) : (
            <Route
              path="/lessons"
              element={
                <Page title="Mijn lessen" subtitle="Bekijk je geplande lessen en opnames terug.">
                  <StudentLessons />
                </Page>
              }
            />
          )}
          <Route
            path="/profile"
            element={
              <Page title="Mijn profiel" subtitle="Beheer je gegevens en beveiliging.">
                <ProfilePage user={user} onUpdated={onUserUpdate} />
              </Page>
            }
          />
          <Route path="*" element={<Navigate to="/lessons" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Page({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
