import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';

interface SubjectContextValue {
  subjectId: number | null;
  setSubjectId: (id: number | null) => void;
}

const SubjectContext = createContext<SubjectContextValue | undefined>(undefined);

export function SubjectProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [subjectId, setSubjectId] = useState<number | null>(user?.id ?? null);

  useEffect(() => {
    setSubjectId(user?.id ?? null);
  }, [user?.id]);

  const value = useMemo(() => ({ subjectId, setSubjectId }), [subjectId]);

  return <SubjectContext.Provider value={value}>{children}</SubjectContext.Provider>;
}

export function useSubject() {
  const context = useContext(SubjectContext);
  if (!context) {
    throw new Error('useSubject must be used within SubjectProvider');
  }
  return context;
}
