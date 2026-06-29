using System.Diagnostics;
using System.ServiceProcess;

namespace ZeroLag.RuntimeGuard.Service;

internal sealed class GuardOptions
{
    public string WorkerBinary { get; init; } = "";
    public string SessionPath { get; init; } = "";
    public string HealthFile { get; init; } = "";
    public string LogFile { get; init; } = "";
    public bool ConsoleMode { get; init; }

    public static GuardOptions Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var index = 0; index < args.Length; index += 1)
        {
            var current = args[index];
            if (!current.StartsWith("--", StringComparison.Ordinal)) continue;

            if (index + 1 < args.Length && !args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                values[current] = args[index + 1];
                index += 1;
            }
            else
            {
                flags.Add(current);
            }
        }

        return new GuardOptions
        {
            WorkerBinary = GetRequired(values, "--worker-binary"),
            SessionPath = GetRequired(values, "--session"),
            HealthFile = GetValue(values, "--health-file"),
            LogFile = GetValue(values, "--log-file"),
            ConsoleMode = flags.Contains("--console")
        };
    }

    private static string GetRequired(Dictionary<string, string> values, string key)
    {
        var value = GetValue(values, key);
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{key} is required.");
        return value;
    }

    private static string GetValue(Dictionary<string, string> values, string key)
    {
        return values.TryGetValue(key, out var value) ? value : "";
    }
}

internal sealed class RuntimeGuardWindowsService : ServiceBase
{
    private readonly GuardOptions options;
    private readonly object syncRoot = new();
    private Process? worker;
    private Timer? supervisor;

    public RuntimeGuardWindowsService(GuardOptions options)
    {
        this.options = options;
        ServiceName = "ZeroLagRuntimeGuard";
        CanStop = true;
        CanShutdown = true;
    }

    protected override void OnStart(string[] args)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(options.HealthFile) ?? ".");
        Directory.CreateDirectory(Path.GetDirectoryName(options.LogFile) ?? ".");
        StartWorker();
        supervisor = new Timer(_ => EnsureWorker(), null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
        WriteWrapperEvent("started");
    }

    protected override void OnStop()
    {
        supervisor?.Dispose();
        StopWorker();
        WriteWrapperEvent("stopped");
    }

    protected override void OnShutdown()
    {
        OnStop();
    }

    public void RunConsole()
    {
        OnStart(Array.Empty<string>());
        Console.WriteLine("ZeroLag Runtime Guard Service wrapper is running. Press Ctrl+C to stop.");
        using var stopEvent = new ManualResetEventSlim(false);
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            stopEvent.Set();
        };
        stopEvent.Wait();
        OnStop();
    }

    private void EnsureWorker()
    {
        lock (syncRoot)
        {
            if (worker is { HasExited: false }) return;
            StartWorker();
        }
    }

    private void StartWorker()
    {
        lock (syncRoot)
        {
            if (worker is { HasExited: false }) return;

            var arguments = BuildWorkerArguments();
            var info = new ProcessStartInfo
            {
                FileName = options.WorkerBinary,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(options.WorkerBinary) ?? AppContext.BaseDirectory
            };

            worker = Process.Start(info);
            WriteWrapperEvent("worker-started");
        }
    }

    private void StopWorker()
    {
        lock (syncRoot)
        {
            if (worker == null) return;
            if (!worker.HasExited)
            {
                worker.Kill(entireProcessTree: true);
                worker.WaitForExit(5000);
            }
            worker.Dispose();
            worker = null;
        }
    }

    private string BuildWorkerArguments()
    {
        var parts = new List<string>
        {
            "--runtime-guard-service",
            "--session",
            Quote(options.SessionPath)
        };

        if (!string.IsNullOrWhiteSpace(options.HealthFile))
        {
            parts.Add("--health-file");
            parts.Add(Quote(options.HealthFile));
        }

        if (!string.IsNullOrWhiteSpace(options.LogFile))
        {
            parts.Add("--log-file");
            parts.Add(Quote(options.LogFile));
        }

        return string.Join(" ", parts);
    }

    private void WriteWrapperEvent(string eventName)
    {
        if (string.IsNullOrWhiteSpace(options.LogFile)) return;
        var line = $"{DateTimeOffset.UtcNow:O} wrapper {eventName}{Environment.NewLine}";
        File.AppendAllText(options.LogFile, line);
    }

    private static string Quote(string value)
    {
        return $"\"{value.Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
    }
}

internal static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            var options = GuardOptions.Parse(args);
            var service = new RuntimeGuardWindowsService(options);

            if (Environment.UserInteractive || options.ConsoleMode)
            {
                service.RunConsole();
            }
            else
            {
                ServiceBase.Run(service);
            }

            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
