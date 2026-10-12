// Worker for parsing CSV files off the main thread

self.onmessage = (e: MessageEvent) => {
    const { content, format: _format, id } = e.data;

    try {
        const lines = content.split('\n').filter((line: string) => line.trim());
        if (lines.length < 2) {
            self.postMessage({ id, result: [], error: 'File is empty' });
            return;
        }

        // Basic parsing logic (simplified for worker)
        // In a real scenario, we'd import the full parser logic or duplicate it here
        // For now, we'll return a placeholder structure to prove worker execution

        const headers = lines[0].split(',').map((h: string) => h.trim());
        const data = lines.slice(1).map((line: string) => {
            const values = line.split(',');
            return headers.reduce((obj: any, header: string, index: number) => {
                obj[header] = values[index]?.trim();
                return obj;
            }, {});
        });

        self.postMessage({ id, result: data });

    } catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : 'Unknown error' });
    }
};
