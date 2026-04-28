declare module 'opencc-js' {
  export interface ConverterOptions {
    from: 'cn' | 'tw' | 'hk' | 'jp' | 't';
    to: 'cn' | 'tw' | 'hk' | 'jp' | 't';
  }
  export function Converter(opts: ConverterOptions): (text: string) => string;
}
