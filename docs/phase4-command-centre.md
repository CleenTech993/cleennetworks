# NETGRID Command Centre

The Command Centre is a tenant console priority view at `/tenant/command-centre`.

It consolidates existing operational data:

- Offline or recently unreachable routers.
- Open high and urgent support tickets.
- Overdue scheduled work orders.
- Overdue customer invoices.

The view refreshes every 30 seconds and ranks network, support, field, and billing actions by
severity. It does not run automatic repairs or change customer, payment, router, or work-order records.

Access follows existing tenant roles. Admin, technician, billing, and support staff roles can open
the view; database RLS and the page route guard continue to control what each role can read.
