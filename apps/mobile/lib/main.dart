import 'package:flutter/material.dart';

void main() {
  runApp(const QronoApp());
}

/// Qrono participant app.
///
/// Scope for v1 (PRD §1.1): the event program, my tasks, the countdown,
/// task comments, broadcasts (push, with Acknowledge / Snooze / Done),
/// accepting or declining a role, and approving events for Approvers.
/// Sign-up happens on the web; the app offers log in and password reset.
class QronoApp extends StatelessWidget {
  const QronoApp({super.key});

  static const _accent = Color(0xFFF5B301);
  static const _background = Color(0xFF0B0D12);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Qrono',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: _accent,
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: _background,
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Qrono', style: TextStyle(fontWeight: FontWeight.w800)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('My events', style: textTheme.headlineSmall),
          const SizedBox(height: 12),
          const Card(
            child: ListTile(
              leading: Icon(Icons.event_outlined),
              title: Text('No events yet'),
              subtitle: Text(
                "Events you're assigned to will appear here, with your tasks "
                'and a countdown to the start.',
              ),
            ),
          ),
        ],
      ),
    );
  }
}
