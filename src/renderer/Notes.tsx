// Plain text notes of a project, saved automatically shortly after typing stops.
import { useEffect, useRef, useState } from 'react';
import type { Project } from '../shared/types';
import { api, errorMessage } from './api';

const SAVE_DELAY_MS = 800;

interface Props {
  project: Project;
  onChanged: (project: Project) => void;
  onError: (message: string) => void;
}

export function Notes({ project, onChanged, onError }: Props) {
  const [text, setText] = useState(project.notes);
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving'>('saved');
  const pending = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = () => {
    clearTimeout(timer.current);
    const value = pending.current;
    if (value === undefined) return;
    pending.current = undefined;
    setStatus('saving');
    api.setProjectNotes(project.id, value).then(
      (updated) => {
        onChanged(updated);
        if (pending.current === undefined) setStatus('saved');
      },
      (e: unknown) => onError(errorMessage(e)),
    );
  };

  // Notes that are still being typed are saved when the tab or project is left.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => saveRef.current(), []);

  return (
    <section className="card form">
      <div className="row notes-header">
        <h3>Notes</h3>
        <span className="hint">{status === 'saved' ? 'Saved' : 'Saving…'}</span>
      </div>
      <textarea
        className="notes"
        value={text}
        placeholder="Notes for this project…"
        spellCheck
        onChange={(e) => {
          setText(e.target.value);
          pending.current = e.target.value;
          setStatus('pending');
          clearTimeout(timer.current);
          timer.current = setTimeout(save, SAVE_DELAY_MS);
        }}
        onBlur={save}
      />
    </section>
  );
}
