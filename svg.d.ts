import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicAttributes {
      [elemName: string]: any;
    }
  }
}