import { useEffect, useState, useCallback } from 'react';
import { jarvis2Service, Jarvis2Snapshot } from '../services/Jarvis2Service';

export const useJarvis2 = () => {
    const [snapshot, setSnapshot] = useState<Jarvis2Snapshot>(jarvis2Service.snapshot());

    useEffect(() => {
        const unsub = jarvis2Service.subscribe(setSnapshot);
        return () => { unsub(); };
    }, []);

    const open = useCallback(() => jarvis2Service.open(), []);
    const close = useCallback(() => jarvis2Service.close(), []);
    const toggleOpen = useCallback(() => jarvis2Service.toggleOpen(), []);
    const startListening = useCallback(() => jarvis2Service.startListening(), []);
    const stopListening = useCallback(() => jarvis2Service.stopListening(), []);
    const stopSpeaking = useCallback(() => jarvis2Service.stopSpeaking(), []);
    const submitTyped = useCallback((text: string) => jarvis2Service.submitTyped(text), []);
    const dismissAlert = useCallback((id: string) => jarvis2Service.dismissAlert(id), []);
    const dismissLatestAlert = useCallback(() => jarvis2Service.dismissLatestAlert(), []);

    return {
        snapshot,
        open,
        close,
        toggleOpen,
        startListening,
        stopListening,
        stopSpeaking,
        submitTyped,
        dismissAlert,
        dismissLatestAlert,
    };
};

export default useJarvis2;
