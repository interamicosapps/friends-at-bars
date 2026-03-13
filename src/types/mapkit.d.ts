/**
 * Minimal MapKit JS types for init + Map + MarkerAnnotation.
 * Apple docs: https://developer.apple.com/documentation/mapkitjs
 */
export {};

declare global {
  interface MapKitMapOptions {
    region?: mapkit.CoordinateRegion;
  }

  namespace mapkit {
    function init(options: {
      authorizationCallback: (done: (token: string) => void) => void;
    }): void;

    class Coordinate {
      constructor(latitude: number, longitude: number);
    }

    class CoordinateRegion {
      constructor(
        center: Coordinate,
        span: CoordinateSpan
      );
    }

    class CoordinateSpan {
      constructor(latitudeDelta: number, longitudeDelta: number);
    }

    class Map {
      constructor(element: HTMLElement, options?: MapKitMapOptions);
      region: CoordinateRegion;
      addAnnotation(annotation: Annotation): void;
      removeAnnotation(annotation: Annotation): void;
      destroy(): void;
      selectedAnnotation: Annotation | null;
      annotations: Annotation[];
    }

    class Annotation {
      coordinate: Coordinate;
      title: string;
      subtitle?: string;
      // EventTarget-style in MapKit JS
      addEventListener(
        type: string,
        listener: (event: { target: Annotation }) => void
      ): void;
    }

    class MarkerAnnotation extends Annotation {
      constructor(coordinate: Coordinate, options?: { title?: string; subtitle?: string });
    }
  }
}
