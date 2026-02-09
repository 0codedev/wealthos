import React, { createContext, useContext, useState, ReactNode } from 'react';

export type FamilyEntity = 'ALL' | 'SELF' | 'SPOUSE' | 'HUF' | 'KIDS' | 'MOM';

interface FamilyContextType {
    activeEntity: FamilyEntity;
    setActiveEntity: (entity: FamilyEntity) => void;
    getEntityName: (entity: FamilyEntity) => string;
}

const FamilyContext = createContext<FamilyContextType | undefined>(undefined);

export const FamilyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [activeEntity, setActiveEntity] = useState<FamilyEntity>('SELF');

    const getEntityName = (entity: FamilyEntity) => {
        switch (entity) {
            case 'ALL': return 'Family Office';
            case 'SELF': return 'My Portfolio';
            case 'SPOUSE': return 'Spouse';
            case 'HUF': return 'HUF Account';
            case 'KIDS': return 'Kids Trust';
            case 'MOM': return 'Mom';
            default: return 'Portfolio';
        }
    };

    return (
        <FamilyContext.Provider value={{ activeEntity, setActiveEntity, getEntityName }}>
            {children}
        </FamilyContext.Provider>
    );
};

export const useFamily = () => {
    const context = useContext(FamilyContext);
    if (!context) {
        throw new Error('useFamily must be used within a FamilyProvider');
    }
    return context;
};
