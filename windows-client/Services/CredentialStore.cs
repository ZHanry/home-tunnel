using System.ComponentModel;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Text;

namespace HomeTunnel.Client.Services;

public static class CredentialStore
{
    private const uint CredTypeGeneric = 1;
    private const uint CredPersistLocalMachine = 2;

    public static void Write(string target, string secret)
    {
        var bytes = Encoding.Unicode.GetBytes(secret);
        var blob = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new NativeCredential
            {
                Type = CredTypeGeneric,
                TargetName = target,
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blob,
                Persist = CredPersistLocalMachine,
                UserName = Environment.UserName,
            };
            if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            for (var index = 0; index < bytes.Length; index++) Marshal.WriteByte(blob, index, 0);
            Array.Clear(bytes);
            Marshal.FreeCoTaskMem(blob);
        }
    }

    public static string? Read(string target)
    {
        if (!CredRead(target, CredTypeGeneric, 0, out var pointer)) return null;
        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(pointer);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0) return null;
            return Marshal.PtrToStringUni(credential.CredentialBlob, checked((int)credential.CredentialBlobSize / 2));
        }
        finally
        {
            CredFree(pointer);
        }
    }

    public static void Delete(string target)
    {
        if (!CredDelete(target, CredTypeGeneric, 0))
        {
            var error = Marshal.GetLastWin32Error();
            if (error != 1168) throw new Win32Exception(error);
        }
    }

    public static string Target(string serverBaseUrl, string deviceId)
    {
        var originHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(serverBaseUrl.Trim())))
            .ToLowerInvariant()[..16];
        return $"HomeTunnel.Device.{originHash}.{deviceId}";
    }

    public static string LegacyTarget(string deviceId) => $"HomeTunnel.Device.{deviceId}";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite([In] ref NativeCredential credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", SetLastError = false)]
    private static extern void CredFree(IntPtr buffer);
}
