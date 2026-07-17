import ImageInfoViewer from './ImageInfoViewer';

export default function ImageInfoPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-zinc-900 mb-2">Image Info</h1>
        <p className="text-zinc-500 text-sm max-w-xl mx-auto">
          Drop a PNG rendered by the Pseudorandom Rhino plugin to see its embedded environmental
          impact data.
        </p>
      </div>

      <ImageInfoViewer />
    </div>
  );
}
