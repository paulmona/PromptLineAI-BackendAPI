declare module 'nunjucks' {
  export interface Environment {
    render(name: string, context?: any): string;
    renderString(template: string, context?: any): string;
  }

  export function configure(path: string, options?: any): Environment;
  export function render(name: string, context?: any): string;
  export function renderString(template: string, context?: any): string;

  const nunjucks: {
    configure(path: string, options?: any): Environment;
    render(name: string, context?: any): string;
    renderString(template: string, context?: any): string;
  };

  export default nunjucks;
}
