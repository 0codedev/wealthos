import { usePageVisibility as useVisibilityFromContext } from '../contexts/PageVisibilityContext';

/**
 * @deprecated Use usePageVisibility from ../contexts/PageVisibilityContext instead
 */
export const usePageVisibility = () => {
    return useVisibilityFromContext();
};
