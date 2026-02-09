import React, { createContext, useContext, useState, useEffect } from 'react';

const PageVisibilityContext = createContext<boolean>(true);

export const PageVisibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsVisible(document.visibilityState === 'visible');
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    return (
        <PageVisibilityContext.Provider value={isVisible}>
            {children}
        </PageVisibilityContext.Provider>
    );
};

export const usePageVisibility = () => {
    return useContext(PageVisibilityContext);
};
