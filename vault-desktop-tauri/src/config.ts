export const PRODUCTION_DOMAIN = "ahs.mayfairmarketing.online";

export const getBackendUrl = () => {
  if (import.meta.env.DEV) {
    return "http://localhost:8080";
  }
  return `https://${PRODUCTION_DOMAIN}`;
};
