import { requirePage } from '@/lib/auth';
import { ContactForm } from '@/components/ContactForm';

export default async function NewContact() {
  await requirePage('contact.create');
  return (<><div className="top"><div><h1>สร้างรายชื่อผู้ติดต่อ</h1></div></div><ContactForm id={null} init={{}} canSave /></>);
}
