using System;
using System.Runtime.InteropServices;
using System.Security;

public static class HsLmsCredential {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool WriteNative(ref Credential c, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool ReadNative(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool DeleteNative(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr buffer);
    private static bool Open(string target, out IntPtr pointer) {
        if (ReadNative(target, 1, 0, out pointer)) return true;
        if (Marshal.GetLastWin32Error() == 1168) return false;
        throw new InvalidOperationException("CREDENTIAL_STORE_ERROR");
    }
    public static bool Exists(string target) {
        IntPtr p; if (!Open(target, out p)) return false;
        try { return true; } finally { CredFree(p); }
    }
    public static void Save(string target, SecureString id, SecureString password) {
        if (id.Length == 0 || id.Length > 513 || password.Length == 0 || password.Length * 2 > 2560) throw new InvalidOperationException("INVALID_INPUT");
        IntPtr u = IntPtr.Zero, p = IntPtr.Zero;
        try {
            u = Marshal.SecureStringToCoTaskMemUnicode(id);
            p = Marshal.SecureStringToCoTaskMemUnicode(password);
            Credential c = new Credential(); c.Type = 1; c.TargetName = target;
            c.UserName = Marshal.PtrToStringUni(u); c.CredentialBlob = p;
            c.CredentialBlobSize = (uint)(password.Length * 2); c.Persist = 2; // current user, local machine, across logons
            if (!WriteNative(ref c, 0)) throw new InvalidOperationException("CREDENTIAL_STORE_ERROR");
        } finally {
            if (u != IntPtr.Zero) Marshal.ZeroFreeCoTaskMemUnicode(u);
            if (p != IntPtr.Zero) Marshal.ZeroFreeCoTaskMemUnicode(p);
        }
    }
    public static string[] Read(string target) {
        IntPtr p; if (!Open(target, out p)) return null;
        IntPtr blob = IntPtr.Zero; uint length = 0;
        try {
            Credential c = (Credential)Marshal.PtrToStructure(p, typeof(Credential));
            if (c.CredentialBlobSize == 0 || c.CredentialBlobSize > 2560 || c.CredentialBlobSize % 2 != 0) throw new InvalidOperationException("CREDENTIAL_STORE_ERROR");
            blob = c.CredentialBlob; length = c.CredentialBlobSize;
            return new string[] { c.UserName, Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2) };
        } finally {
            if (blob != IntPtr.Zero) for (int i = 0; i < length; i++) Marshal.WriteByte(blob, i, 0);
            CredFree(p);
        }
    }
    public static void Remove(string target) {
        if (!DeleteNative(target, 1, 0) && Marshal.GetLastWin32Error() != 1168) throw new InvalidOperationException("CREDENTIAL_STORE_ERROR");
    }
}
