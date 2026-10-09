const user = { uid: 'teacher1', email: 'teacher@example.com' };
export const getAuth = () => ({ currentUser: user });
export const onAuthStateChanged = (auth, cb) => { setTimeout(() => cb(new URLSearchParams(location.search).get('host') === '1' || localStorage.getItem('mock_teacher') ? user : null), 30); return () => {}; };
export const signInWithEmailAndPassword = async () => ({ user });
export const createUserWithEmailAndPassword = async () => ({ user });
export const sendPasswordResetEmail = async () => {};
export const signOut = async () => {};
