import { useState, useCallback, useEffect, useRef } from 'react';

type SimulationType = 'RETIREMENT' | 'GOAL_GPS' | 'OPTION_EUROPEAN_MC';

interface WorkerResult<T> {
    data: T | null;
    isLoading: boolean;
    progress: number;
    error: string | null;
    run: (params: any) => void;
}

/**
 * Hook for running Monte Carlo simulations in a Web Worker
 * Prevents UI freezes during heavy computations
 */
export function useMonteCarloWorker<T>(type: SimulationType): WorkerResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const workerRef = useRef<Worker | null>(null);

    // Initialize worker
    useEffect(() => {
        // Create worker using Vite's import.meta.url for worker modules
        workerRef.current = new Worker(
            new URL('../workers/monteCarloWorker.ts', import.meta.url),
            { type: 'module' }
        );

        workerRef.current.onmessage = (e: MessageEvent) => {
            const { type: msgType, result, progress: prog, error: err } = e.data;

            if (msgType === 'PROGRESS') {
                setProgress(prog);
            } else if (msgType === 'COMPLETE') {
                setData(result);
                setIsLoading(false);
                setProgress(100);
            } else if (msgType === 'ERROR') {
                setError(err);
                setIsLoading(false);
            }
        };

        workerRef.current.onerror = (e) => {
            setError(`Worker error: ${e.message}`);
            setIsLoading(false);
        };

        return () => {
            workerRef.current?.terminate();
        };
    }, []);

    const run = useCallback((params: any) => {
        if (!workerRef.current) {
            setError('Worker not initialized');
            return;
        }

        setIsLoading(true);
        setProgress(0);
        setError(null);
        setData(null);

        workerRef.current.postMessage({ type, params });
    }, [type]);

    return { data, isLoading, progress, error, run };
}

export default useMonteCarloWorker;
