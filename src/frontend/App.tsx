function App() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10">
      <section className="max-w-xl w-full bg-white rounded-card shadow-soft p-8 text-center">
        <h1 className="font-hand text-5xl text-accent mb-4">妆语</h1>
        <p className="text-lg leading-relaxed text-ink/80 mb-6">
          你的闺蜜化妆间，上传一张自拍，告诉我你的五官，陪你挑妆容、一步步教你化。
        </p>
        <button
          type="button"
          className="bg-primary hover:bg-accent transition-colors text-white font-medium px-6 py-3 rounded-full shadow-soft"
        >
          上传自拍，开始分析
        </button>
      </section>
    </main>
  );
}

export default App;
