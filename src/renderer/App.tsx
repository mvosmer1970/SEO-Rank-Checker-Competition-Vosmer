import { useCallback, useEffect, useState } from 'react';
import type { AuthStatus, Project, ResearchSite, SyncResult } from '../shared/types';
import { api, errorMessage } from './api';
import { startCrawl } from './crawler';
import { ProjectForm } from './ProjectForm';
import { ProjectView } from './ProjectView';
import { ResearchForm, ResearchView } from './ResearchView';
import { Settings } from './Settings';
import { getTheme, setTheme, THEMES, type Theme } from './theme';

type View =
  | { kind: 'project'; id: string }
  | { kind: 'new' }
  | { kind: 'settings' }
  | { kind: 'empty' }
  | { kind: 'research'; id: string }
  | { kind: 'newResearch' };

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [auth, setAuth] = useState<AuthStatus>({ configured: false, signedIn: false });
  const [view, setView] = useState<View>({ kind: 'empty' });
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<SyncResult | undefined>();
  const [researchSites, setResearchSites] = useState<ResearchSite[]>([]);
  const [theme, setThemeState] = useState<Theme>(getTheme);

  useEffect(() => {
    api.listResearchSites().then(setResearchSites, (e: unknown) => setError(errorMessage(e)));
  }, []);

  const onResearchChanged = useCallback((site: ResearchSite) => {
    setResearchSites((list) => (list.some((s) => s.id === site.id) ? list.map((s) => (s.id === site.id ? site : s)) : [...list, site]));
  }, []);
  const selectedResearch = view.kind === 'research' ? researchSites.find((s) => s.id === view.id) : undefined;

  // Every sync (manual or automatic in the background) reloads the projects and the history of the open project.
  useEffect(
    () =>
      api.onSynced((result) => {
        setLastSync(result);
        api.listProjects().then(setProjects, (e: unknown) => setError(errorMessage(e)));
      }),
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const [list, status] = await Promise.all([api.listProjects(), api.getAuthStatus()]);
      setProjects(list);
      setAuth(status);
      return { list, status };
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    }
  }, []);

  useEffect(() => {
    void refresh().then((result) => {
      if (!result) return;
      if (!result.status.signedIn) setView({ kind: 'settings' });
      else if (result.list[0]) setView({ kind: 'project', id: result.list[0].id });
    });
  }, [refresh]);

  const selected = view.kind === 'project' ? projects.find((p) => p.id === view.id) : undefined;

  const onProjectChanged = (project: Project) => {
    // Keep the order of the sidebar: replace the project in place, a new one goes at the end.
    setProjects((list) =>
      list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? project : p)) : [...list, project],
    );
  };

  /** Drag and drop in the sidebar: the dragged project goes before the one it is dropped on (or at the end). */
  const [dragId, setDragId] = useState<string | undefined>();
  const [dropTarget, setDropTarget] = useState<string | undefined>();
  const moveProject = (id: string, beforeId: string | undefined) => {
    const moved = projects.find((p) => p.id === id);
    if (!moved || id === beforeId) return;
    const rest = projects.filter((p) => p.id !== id);
    const index = beforeId ? rest.findIndex((p) => p.id === beforeId) : -1;
    const next = index < 0 ? [...rest, moved] : [...rest.slice(0, index), moved, ...rest.slice(index)];
    setProjects(next);
    api.reorderProjects(next.map((p) => p.id)).catch((e: unknown) => setError(errorMessage(e)));
  };

  return (
    <>
      <div className="titlebar">
        SEO Rank Tracker <span className="titlebar-version">v{__APP_VERSION__}</span>
      </div>
    <div className="app">
      <aside className="sidebar">
        <h1 className="brand">
          SEO Rank Tracker <span className="brand-version">v{__APP_VERSION__}</span>
        </h1>
        <nav
          className="project-list"
          onDragOver={(e) => {
            if (dragId) e.preventDefault();
          }}
          onDrop={(e) => {
            // Dropped below the last project: move to the end.
            e.preventDefault();
            if (dragId) moveProject(dragId, undefined);
            setDragId(undefined);
            setDropTarget(undefined);
          }}
        >
          {projects.map((p) => (
            <button
              key={p.id}
              draggable
              title="Drag to reorder; the top project opens when the app starts"
              className={`nav-item${selected?.id === p.id ? ' active' : ''}${dragId === p.id ? ' dragging' : ''}${
                dropTarget === p.id && dragId !== p.id ? ' drop-before' : ''
              }`}
              onClick={() => setView({ kind: 'project', id: p.id })}
              onDragStart={(e) => {
                setDragId(p.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragId(undefined);
                setDropTarget(undefined);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropTarget(p.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragId) moveProject(dragId, p.id);
                setDragId(undefined);
                setDropTarget(undefined);
              }}
            >
              <span className="nav-name">{p.name}</span>
              <span className="nav-meta">{p.keywords.length} keywords</span>
            </button>
          ))}
          {projects.length === 0 && <p className="muted small">No projects yet.</p>}

          <h2 className="sidebar-heading">Site research</h2>
          {researchSites.map((s) => (
            <button
              key={s.id}
              className={`nav-item research-item${selectedResearch?.id === s.id ? ' active' : ''}`}
              onClick={() => setView({ kind: 'research', id: s.id })}
            >
              <span className="nav-name">{s.domain}</span>
              <span className="nav-meta">{s.lastCrawlAt ? `${s.pageCount} pages` : 'not crawled'}</span>
            </button>
          ))}
          <button className={`nav-item research-item add-item${view.kind === 'newResearch' ? ' active' : ''}`} onClick={() => setView({ kind: 'newResearch' })}>
            <span className="nav-meta">+ Research a site</span>
          </button>
        </nav>
        <div className="sidebar-actions">
          <button className="primary" onClick={() => setView({ kind: 'new' })}>
            New project
          </button>
          <button className={view.kind === 'settings' ? 'active' : ''} onClick={() => setView({ kind: 'settings' })}>
            Settings {auth.signedIn ? '' : '⚠'}
          </button>
        </div>
      </aside>

      <main className="content">
        <div className="theme-bar">
          <label className="check small" title="Color theme">
            Theme
            <select
              value={theme}
              onChange={(e) => {
                const value = e.target.value as Theme;
                setThemeState(value);
                setTheme(value);
              }}
            >
              {THEMES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button className="link" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}

        {view.kind === 'settings' && <Settings auth={auth} onChanged={() => void refresh()} onError={setError} />}

        {view.kind === 'new' && (
          <ProjectForm
            signedIn={auth.signedIn}
            onCancel={() => setView(projects[0] ? { kind: 'project', id: projects[0].id } : { kind: 'empty' })}
            onSave={async (input) => {
              const project = await api.createProject(input);
              onProjectChanged(project);
              setView({ kind: 'project', id: project.id });
            }}
          />
        )}

        {view.kind === 'project' && selected && (
          <ProjectView
            key={selected.id}
            project={selected}
            signedIn={auth.signedIn}
            lastSync={lastSync?.projectId === selected.id ? lastSync : undefined}
            onChanged={onProjectChanged}
            onDeleted={() => {
              const rest = projects.filter((p) => p.id !== selected.id);
              setProjects(rest);
              setView(rest[0] ? { kind: 'project', id: rest[0].id } : { kind: 'empty' });
            }}
            onError={setError}
          />
        )}

        {view.kind === 'newResearch' && (
          <ResearchForm
            onCancel={() => setView(projects[0] ? { kind: 'project', id: projects[0].id } : { kind: 'empty' })}
            onSave={async (input) => {
              const site = await api.createResearchSite(input);
              onResearchChanged(site);
              setView({ kind: 'research', id: site.id });
              startCrawl(site, onResearchChanged);
            }}
          />
        )}

        {view.kind === 'research' && selectedResearch && (
          <ResearchView
            key={selectedResearch.id}
            site={selectedResearch}
            onChanged={onResearchChanged}
            onDeleted={() => {
              setResearchSites((list) => list.filter((s) => s.id !== selectedResearch.id));
              setView(projects[0] ? { kind: 'project', id: projects[0].id } : { kind: 'empty' });
            }}
            onError={setError}
          />
        )}

        {(view.kind === 'empty' || (view.kind === 'project' && !selected)) && (
          <div className="empty-state">
            <h2>No project selected</h2>
            <p className="muted">Create a project for one of your Search Console properties to start tracking keywords.</p>
            <button className="primary" onClick={() => setView({ kind: 'new' })}>
              New project
            </button>
          </div>
        )}
      </main>
    </div>
    </>
  );
}
